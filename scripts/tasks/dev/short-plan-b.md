# Move the session cookie's expiry into config

## Context

The session cookie's lifetime is a literal in the auth middleware. Support has asked twice
this quarter for a shorter window on the admin tenant, and each request has meant a code
change and a deploy for what is really a policy knob.

## Approach

Read the lifetime from config, defaulting to the value the literal carries today, so an
untouched deployment keeps behaving exactly as it does now.

Validation happens at load rather than at cookie-issue time: a bad value should stop the
process at boot instead of surfacing hours later as a stream of failed logins.

## Steps

1. Add a `session.max_age` key, defaulting to the current fourteen days.
2. Read it once at startup and pass it into the middleware.
3. Reject a non-positive or unparseable value at load, naming the key.
4. Document the key beside the other auth settings.

## Verification

Boot with the key absent and confirm the issued cookie still carries a fourteen-day
expiry. Set it to one hour, log in, and confirm the cookie expires on the hour. Set it to
zero and confirm the process refuses to start.

## Risks

Shortening the window logs everyone out at the next expiry, so the rollout note has to say
so. The default is unchanged, which keeps that a deliberate act rather than a surprise.
