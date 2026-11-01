# Country flags completed for the original firearm flashcards

The original catalogue contained **2,000** distinct stable model cards and
**238** with empty country codes. The project originally included 13 offline
SVG flags. This update added 17 local SVGs and 43 exact representative
manufacturer-to-country mappings, so **all 2,000 bundled seed cards now have
a locally available country flag**. None of the card IDs, order, titles,
descriptions, image references or existing saved edited values were changed.

## What the flags mean

Flags usually indicate the *present-day nationality of the named
representative manufacturer*, rather than every possible factory that made
the design or the national flag in use during its historical manufacture.

- **Armscor VR80 / VR60 / VRF14** — Philippines means brand headquarters.
  This is explicitly labeled on the card; the true manufacturing country
  and factory are still unverified.
- **G 41** — Germany applies to both proposed makers, Walther and Mauser,
  but the G41(W) versus G41(M) subvariant remains unspecified.
- **MP 3008** — preserves its existing German country code as an historical
  point of reference; the actual producing firm is not identified.
- **Krag–Jørgensen M1889 / M1894 / M1898** — Denmark / Norway / US respectively,
  aligning with the different representative manufacturers in the catalogue.

All newly inferred codes are catalog attributions and marked
`externallyVerified:false` in country-register.js; no independent live
external source verification was available. They should not be represented
as proof of an exact factory for each specific gun.

The original 13 flag SVG files were kept, and the new 17 are served from
the same local `guns/flags/` directory, including offline cache support.
When reading earlier auto-saved records, empty *starter* country fields can
receive the newly available defaults, but explicit manual edits—including
intentionally blank countries—remain untouched. User-added models without
known country data are not assigned imaginary flags.
