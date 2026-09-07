# Draft: BirdNET V2.4 commercial licence inquiry

- **To**: ccb-birdnet@cornell.edu
- **Subject**: Commercial licence terms for BirdNET V2.4 as a fallback model in a consumer iOS app
- **Status**: draft ready (2026-09-07) — **optional until monetisation**. The app is
  non-commercial during the prototype phase, so V2.4 may be used under
  CC BY-NC-SA 4.0 as a `prototype-fallback` (ADR 0006 addendum). Send this before any
  paid feature ships, or remove V2.4 from every build and the worker instead.
- **Owner action**: fill in the bracketed volumes, send, and record the sent date in
  the inquiry log of `docs/licences.md`. Agents do not send email.

---

Dear BirdNET team,

I am building Nature Explorer, a small iOS game where players claim map hexagons by walking and "capture" birds by recording their calls. Bird recognition runs on device and is verified again on our server.

Our primary model is BirdNET+ V3 (the Apache 2.0 weights bundled in BirdNET Live) with the BirdNET Geomodel, credited as "Powered by BirdNET" in the app. Could you tell me on what terms we could also use the BirdNET V2.4 TFLite model (CC BY-NC-SA 4.0) as a fallback classifier once the app becomes commercial (in-app purchases, no ads)?

A few facts that may help:

- Platform: iOS 17+, on-device inference plus a server-side verification worker in the EU.
- Launch: beta in Lithuania, play possible worldwide; expected [N] monthly active players in year one and roughly [M] recordings per day.
- Use of V2.4: fallback only, behind the same interface as V3, never the sole model.
- Attribution: "Powered by BirdNET" with the Cornell Lab / TU Chemnitz credit on the capture screen and in the app's licences page, and a citation of the BirdNET paper.
- Until we have a written licence, V2.4 stays out of every commercial build.

Let me know if a short call is easier, or if there is a standard licence agreement I should look at.

Warm regards,
[owner name]
[project e-mail]
