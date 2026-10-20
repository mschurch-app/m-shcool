# Face recognition stall recovery

User explicitly requested automatic page reload when face recognition stalls. Only the face-camera recovery behavior changes; independent login, role grants, API matching threshold, database and data mutation semantics are unchanged.

A 2-second in-browser liveness check watches completed inference/matching cycles and the advancing video clock. Thirty seconds without progress requests one reload. The page is reloaded only after no attendance request is active, no uncertain flow operation remains, and the UI confirms no dirty form, busy save or open dialog. Hidden/stopped cameras do not reload. No writes are automatically replayed.

The tab's sessionStorage retains only the recovery timestamp, Taipei day and already-claimed person IDs (no image, descriptor, name or auth credential). On reload, a one-time marker no older than two minutes restores the anti-repeat presence state and attempts to reopen the existing face camera. A person remains blocked until the existing five-second observed-absence rule rearms them. Camera permission failure uses the existing retry control.

At most one automatic reload is allowed per ten minutes in the same tab. A second stall shows a manual reload/barcode fallback instead of looping. Unavailable storage fails closed to manual recovery. A fully blocked browser main thread cannot run its timer until the browser resumes; real-device camera testing remains required.

Validation: full offline suite and both administrative entries pass, including actual never-settling face-api Promise, healthy long-running frames, frozen video, uncertain/active attendance writes, dirty forms, modal readiness, cooldown, storage failure, stale resume, preserved anti-repeat state, and hidden/stopped camera cases. No production attendance was written during tests.

Release both index.html and index2.html with the shared UI readiness predicate and refreshed UI asset version. Update the release hash manifest. Mirror the same source into Church OS school/index.html with its existing generation process. Roll back by reverting this frontend commit and restoring the prior release manifest; no database recovery is needed.
