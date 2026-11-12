# PropertyLens

Prototype for commercial-property underwriting review: a sourced property profile, follow-up questions ranked by how much they could change the answer, a readable loss model, address-to-parcel matching and document extraction.

**Open it:** https://yz3639-gif.github.io/PropertyLens/

## What is in the page

| Area | What it does | Data |
|---|---|---|
| Desk and submission workspace | Premium range, which open inputs to ask about first, simulated answers that narrow the range, Before/After view | Synthetic |
| Risk model | Frequency and severity by peril, exceedance curve, input uncertainty, Sobol drivers, portfolio tail allocation, risk limits | Synthetic properties, illustrative parameters |
| Address matching | Links an address as written to one county parcel, or flags it for review | Real San Francisco open data, retrieved 2026-11-11 |
| New submission | Reads PDFs in the browser; every field links to its page and line | Your documents, or the bundled synthetic samples |
| Premium worksheet, requirements, compliance | Rating worksheet, example rules, insurance-tracking engine with tests | Synthetic |

## What has and has not been shown

- **Address matching:** on a held-out set of 50 business-filing addresses, 46 linked automatically, 4 flagged, no wrong link found. Ground truth is a draft; it still needs to be set independently from county records (`matching-benchmark-sheet.csv` has blank columns for that).
- **Document extraction:** 27 of 27 fields on two synthetic packets and 7 fields read correctly from one real public declarations page. This is not evidence for a 95% accuracy target; that needs real submissions with verified answers. Scanned pages are not read.
- **Risk model:** the method is real and tested (`scripts/riskmodel.test.js`). The rates and damage curves are illustrative and not fitted to loss data, so the dollar figures are not findings.

## Files

- `index.html` – the whole application
- `parcel-index.js` – San Francisco address and parcel index, loaded on first use of live matching
- `matcher.js`, `extractor.js`, `riskmodel.js` – the three engines as standalone modules (browser and Node)
- `scripts/` – index build, sampling, benchmark and model tests
- `sample-documents/` – two synthetic document packets with gold records

Data sources: City and County of San Francisco open data (Enterprise Addressing System, parcels, assessor secured roll 2025).
