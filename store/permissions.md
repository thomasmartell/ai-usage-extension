# Permissions Rationale

Every entry in `manifest.json` under `permissions` and `host_permissions` must
have a matching `## <permission>` section below. The `store:check` tests fail
if a permission is added to the manifest without a documented rationale, or if
a rationale is shorter than 60 characters.

The text in each section is what we paste into the Chrome Web Store
"Justification" fields at submission time, so write it for a human reviewer,
not for ourselves.

## storage

The extension persists the most recent usage snapshot, the cached Claude
organization id, and the GitHub and Netlify tokens the user pastes in
`chrome.storage.local` so they survive service worker restarts and tab reloads. Nothing is read from
or written to any other storage backend.

## alarms

A single recurring `chrome.alarms` entry wakes the service worker every five
minutes to re-fetch the usage limits. Without it the toolbar icon would only
update while the popup was open, which defeats the at-a-glance use case.

## nativeMessaging

Used only by the optional "Mac runner" card. It lets the extension ask a local
helper program (`com.tom.ci_runner`), when one is installed on the computer,
whether a self-hosted CI runner is on, and to start or stop it. The helper must
be registered with the browser and lists this extension as its only allowed
caller. Without it the card stays hidden and nothing is sent anywhere.

## cookies

Used to read the `lastActiveOrg` cookie from `claude.ai` so the extension can
build the correct `/api/organizations/{id}/usage` URL for the user's currently
selected organization. The cookie value is never copied off-device and is only
read, never written.

## host: https://claude.ai/*

Required to call the authenticated Claude usage endpoints
(`/api/organizations` and `/api/organizations/{id}/usage`) with the user's
existing session cookies. No requests are made to any other path on this host.

## host: https://chatgpt.com/*

Required to call `/api/auth/session` (to obtain the short-lived access token
the chatgpt.com web app already uses) and `/backend-api/wham/usage` (the rate
limit endpoint). No other endpoints are accessed.

## host: https://api.github.com/*

Optional GitHub tracking. After the user signs in, the extension reads their
own monthly billing usage (`/users/{login}/settings/billing/usage/summary`),
the organizations they belong to, and, for organizations they administer, the
billing usage summary and budgets. Requests carry the token the user granted
(device sign-in asks for `read:org` and `user`; for organizations the user can
instead paste a fine-grained token with read-only Administration access). The
extension only ever sends GET requests to this host.

## host: https://github.com/login/*

Used only for GitHub's OAuth device flow: `/login/device/code` issues the
one-time code the user enters on github.com, and `/login/oauth/access_token`
returns the token once they approve it. No other path on this host is called.

## host: https://api.netlify.com/*

Optional Netlify tracking. With a personal access token the user pastes, the
extension reads their teams (`/api/v1/accounts`), each team's credit balance
(`/api/v1/{team}/billing/credits`) and build status
(`/api/v1/{team}/builds/status`) to show credits, build minutes and bandwidth
used this billing cycle. It only sends GET requests and never changes anything.
