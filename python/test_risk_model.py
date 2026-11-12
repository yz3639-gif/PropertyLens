"""Checks for the Python loss model, including agreement with the JavaScript model the web page runs.

Run:  python test_risk_model.py

The two implementations use different random-number generators, so they agree statistically, not digit for digit.
Tolerances: expected loss (integrated, little noise) within 3%; simulated tail measures within 12%.
"""
import json
import sys
from pathlib import Path

import numpy as np

import risk_model as rm

REF = json.loads(Path(__file__).with_name("reference_js.json").read_text())
SPECS, JS = REF["specs"], REF["js"]
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS  " if ok else "FAIL  ") + name + (f"   {detail}" if detail else ""))


def close(a, b, tol):
    return abs(a - b) <= tol * max(abs(b), 1.0)


sim = rm.simulate(SPECS, years=400_000)

for spec, prop in zip(SPECS, sim["props"]):
    sid, a, m, js = spec["id"], rm.aal(spec), rm.metrics(prop["loss"]), JS[spec["id"]]
    check(f"{sid}: expected loss matches the JavaScript model within 3%", close(a["total"], js["aal"], 0.03), f"python {a['total']:,.0f}  js {js['aal']:,}")
    check(f"{sid}: every peril matches the JavaScript model within 4% (or $40)",
          all(abs(a["per"][p]["aal"] - js["perils"][p]) <= max(40, 0.04 * js["perils"][p]) for p in rm.PERILS),
          "  ".join(f"{p} {a['per'][p]['aal']:,.0f}/{js['perils'][p]:,}" for p in rm.PERILS))
    check(f"{sid}: simulated expected loss agrees with the integrated one within 4%", close(m["aal"], a["total"], 0.04), f"{m['aal']:,.0f} vs {a['total']:,.0f}")
    check(f"{sid}: tail average (TVaR 99%) within 12% of the JavaScript model", close(m["tvar99"], js["tvar99"], 0.12), f"python {m['tvar99']:,.0f}  js {js['tvar99']:,}")
    check(f"{sid}: exceedance curve never falls as the return period grows", all(b[1] >= a_[1] for a_, b in zip(m["ep"], m["ep"][1:])))
    check(f"{sid}: TVaR 99% is at least the 1-in-100 loss", m["tvar99"] >= m["pml100"])
    check(f"{sid}: peril losses add up to the total", abs(sum(q["aal"] for q in a["per"].values()) - a["total"]) < 1e-6)
    check(f"{sid}: insured loss does not exceed ground-up loss", a["total"] <= a["total_ground_up"] + 1e-9)
    exact = {"flood": 1.8 / 7.3, "fire": 0.9 * 1.1 / 23.1 + 0.1 * 2 / 4.5, "water": 1.3 / 56.3, "wildfire": 2.2 / 3.8}
    check(f"{sid}: mean damage ratios match the exact Beta means within 1.5%", all(close(a["per"][p]["damage_ratio"], exact[p], 0.015) for p in exact),
          "  ".join(f"{p} {a['per'][p]['damage_ratio']:.4f}/{exact[p]:.4f}" for p in exact))
    u = rm.uncertainty(spec)
    check(f"{sid}: P10 <= median <= P90, and the median is within 4% of the JavaScript model", u["p10"] <= u["p50"] <= u["p90"] and close(u["p50"], js["p50"], 0.04), f"{u['p10']:,.0f} / {u['p50']:,.0f} / {u['p90']:,.0f}")
    top2 = [d["k"] for d in js["drivers"][:2]]
    check(f"{sid}: top driver of uncertainty is one of the JavaScript model's top two", u["drivers"][0]["k"] in top2, f"{u['drivers'][0]['k']} ({u['drivers'][0]['share']:.0%}); js {', '.join(top2)}")
    check(f"{sid}: Sobol indices lie in [0, 1] and do not sum past 1", all(0 <= d["sobol"] <= 1 for d in u["drivers"]) and u["explained"] <= 1.0001)

pm, al, jp = rm.metrics(sim["total"]), rm.allocation(sim), REF["portfolio"]
check("portfolio: 1-in-250 loss within 12% of the JavaScript model", close(pm["pml250"], jp["pml250"], 0.12), f"python {pm['pml250']:,.0f}  js {jp['pml250']:,}")
check("portfolio: TVaR 99% within 12% of the JavaScript model", close(pm["tvar99"], jp["tvar99"], 0.12), f"python {pm['tvar99']:,.0f}  js {jp['tvar99']:,}")
check("portfolio: co-TVaR shares add up to portfolio TVaR", close(sum(al["co_tvar"].values()), al["tvar99"], 1e-9))
check("portfolio: holding the properties together is no worse than the sum held alone", al["tvar99"] <= al["sum_standalone"] + 1)
check("portfolio: same property brings the largest share of the tail as in the JavaScript model",
      max(al["co_tvar"], key=al["co_tvar"].get) == max(jp["coTvar"], key=jp["coTvar"].get), max(al["co_tvar"], key=al["co_tvar"].get))

oak = SPECS[0]
base = rm.aal(oak)["total"]
check("a higher deductible lowers the insured expected loss", rm.aal({**oak, "ded": 100_000})["total"] < base)
check("a completed retrofit lowers the expected loss", rm.aal(oak, {**oak["f"], "ret": 0.85})["total"] < base)
check("flood rate: unshaded X < shaded X < AE", rm.flood_rate("X (unshaded)") < rm.flood_rate("X (shaded, 0.2%)") < rm.flood_rate("AE"))
a1, a2 = rm.simulate(SPECS, years=20_000), rm.simulate(SPECS, years=20_000)
check("the same seed gives the same result", np.array_equal(a1["total"], a2["total"]))
check("a property simulates the same alone as inside the portfolio", np.array_equal(rm.simulate([oak], years=20_000)["props"][0]["loss"], a1["props"][0]["loss"]))
lo, hi = rm.metrics(rm.simulate([oak], pick="lo")["total"])["aal"], rm.metrics(rm.simulate([oak], pick="hi")["total"])["aal"]
check("favourable inputs give a lower expected loss than unfavourable ones", lo < hi, f"{lo:,.0f} < {hi:,.0f}")

print(f"\n{sum(results)} of {len(results)} passed")
sys.exit(0 if all(results) else 1)
