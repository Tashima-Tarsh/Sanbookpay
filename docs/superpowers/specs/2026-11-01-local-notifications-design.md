# Local notification delivery

Connect outgoing notifications to the main Sanbookpay Payment API. The owner has an Android phone with an active SIM. Preserve payment processing, existing data, credentials and the current UI.

## Approach

Recommended: use ntfy for owner push alerts, Gmail API with the send-only scope for email, and an authenticated Android SMS gateway on the local network for SMS. Reuse installed googleapis and Node HTTP facilities. The alternative is a self-hosted ntfy and SMTP server; that adds server and mail-deliverability administration and is unnecessary for the requested initial setup. Updating only the legacy upi-collector would leave the main app without delivery.

## Delivery

Generate notifications from existing receipt events. Persist pending delivery work and channel outcomes; retry transient failures with bounded backoff. A provider accepting a message means submitted, never confirmed delivered. Missing recipient/configuration is explicit. Notification failures must not roll back payment success or change financial verification.

Use Gmail API rather than SMTP with gmail.send. Provide loopback OAuth with state validation, save tokens privately without printing them, and document renewal in Google Testing mode. Keep sending credentials separate from inbox-observer authorization.

Support ntfy server URL and topic; public push messages omit customer details, UTRs and other sensitive payment data. Use a random topic. An authenticated self-hosted ntfy remains an option.

Confirm the phone gateway's actual API and authentication before configuring its URL. The bundled observer APK is not assumed to support outgoing SMS. Do not expose the phone API publicly. SIM charges and availability still apply.

## Completion and external steps

Verify adapters and retry/state handling with isolated tests, then run repository checks. Real delivery requires the owner's Gmail consent and phone gateway address/credentials. Send real test messages only to owner-specified recipients. No production deployment or messages to customers are included.

Local HEAD observed: 53b86269918195565438ce7cf845add98a9e14a5, matching the latest GitHub commit previously queried. An existing hosted-check artifact records d7fae513dc3cb9e54d2013672155f01f1051760c; current deployment has not been independently verified for this task.
