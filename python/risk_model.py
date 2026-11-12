"""Property Risk Lens loss model, in Python.

The same model as riskmodel.js (the one the web page runs), written with numpy:

    ground-up loss = replacement cost x damage ratio            (per occurrence, per peril)
    insured loss   = min(limit, max(0, ground-up - deductible))
    annual loss    = sum over perils and occurrences in the year

Three layers:
  1. aal()          expected annual loss per peril, by integrating the damage curve through the policy terms
  2. uncertainty()  open inputs drawn from ranges -> distribution of expected loss and first-order Sobol indices
  3. simulate()     Monte Carlo years with shared earthquake events and shared fire-weather years ->
                    exceedance curve, tail value at risk, and each property's share of the portfolio tail

PARAMETERS ARE ILLUSTRATIVE. They are plausible, not fitted to loss data. The method is what is real.

Run it:   python risk_model.py            (prints the four demo properties and the portfolio)
Test it:  python test_risk_model.py
"""
from __future__ import annotations

import json
import zlib
from pathlib import Path

import numpy as np

# ----------------------------------------------------------------------------------------------- parameters
PERILS = ("flood", "fire", "water", "wildfire", "eq")
PERIL_LABEL = {"flood": "Flood", "fire": "Fire", "water": "Water and other", "wildfire": "Wildfire", "eq": "Earthquake"}
FIRE_INPUTS = ("cons", "prot", "spr", "sys", "occ", "loss")   # factors that scale fire frequency
WATER_INPUTS = ("roof", "sys", "loss")
EQ_INPUTS = ("liq", "eqc", "ret")                             # factors that scale earthquake damage
FIRE_BASE, WATER_BASE = 0.010, 0.050                          # occurrences per year before factors

# Regional earthquake events, shared by every property: (name, annual rate, mean damage ratio)
EQ_EVENTS = (("Moderate (about M6.0)", 1 / 30, 0.02), ("Strong (about M6.7)", 1 / 120, 0.08), ("Major (M7.2 or larger)", 1 / 475, 0.22))
EQ_RATE = sum(e[1] for e in EQ_EVENTS)
EQ_SIGMA, EQ_CAP = 0.6, 0.95                                  # lognormal spread around the event mean; cap on damage

# Fire weather, shared: a bad year multiplies wildfire frequency; other years are scaled so the mean stays 1
WX_P, WX_BAD = 0.12, 4.0
WX_GOOD = (1 - WX_P * WX_BAD) / (1 - WX_P)

RETURN_PERIODS = (2, 5, 10, 25, 50, 100, 250, 500, 1000)
_UNIT_N = 40_000                                              # size of the fixed sample used to integrate each damage curve


def flood_rate(zone: str) -> float:
    """Annual chance of a flood loss from the mapped zone."""
    if zone.startswith(("AE", "A", "V")):
        return 0.010
    if "(shaded" in zone:
        return 0.002
    return 0.0004


def _draw_damage(rng: np.random.Generator, peril: str, n: int) -> np.ndarray:
    """Damage ratios (share of replacement cost) for n occurrences of a peril. Earthquake returns a multiplier with mean 1."""
    if peril == "flood":
        return rng.beta(1.8, 5.5, n)
    if peril == "fire":  # nine fires in ten are partial; one in ten is severe
        severe = rng.random(n) >= 0.9
        return np.where(severe, rng.beta(2.0, 2.5, n), rng.beta(1.1, 22.0, n))
    if peril == "water":
        return rng.beta(1.3, 55.0, n)
    if peril == "wildfire":
        return rng.beta(2.2, 1.6, n)
    if peril == "eq":
        return np.exp(EQ_SIGMA * rng.standard_normal(n) - EQ_SIGMA**2 / 2)
    raise ValueError(peril)


# One fixed sample per damage curve. Reusing it for every evaluation (common random numbers) keeps
# comparisons between inputs free of sampling noise.
_UNIT = {p: _draw_damage(np.random.default_rng(1000 + i), p, _UNIT_N) for i, p in enumerate(PERILS)}


def _prod(f: dict, keys) -> float:
    out = 1.0
    for k in keys:
        out *= f.get(k, 1.0)
    return out


def frequency(spec: dict, f: dict, peril: str) -> float:
    if peril == "flood":
        return flood_rate(spec["floodZone"])
    if peril == "fire":
        return FIRE_BASE * _prod(f, FIRE_INPUTS)
    if peril == "water":
        return WATER_BASE * _prod(f, WATER_INPUTS)
    if peril == "wildfire":
        return spec["burnProb"] * f.get("mit", 1.0)
    return EQ_RATE


def terms(spec: dict, peril: str) -> tuple[float, float]:
    """(limit, deductible) that apply to a peril."""
    limit = min(spec["floodLimit"], spec["limit"]) if peril == "flood" else spec["limit"]
    ded = spec["eqDedPct"] / 100 * spec["limit"] if peril == "eq" else spec["ded"]
    return limit, ded


def insured(ground_up, limit: float, ded: float):
    return np.minimum(limit, np.maximum(0.0, ground_up - ded))


# ----------------------------------------------------------------------------------------------- 1. expected loss
def aal(spec: dict, f: dict | None = None, tiv_mult: float = 1.0) -> dict:
    """Expected annual loss by peril: frequency x mean insured loss per occurrence."""
    f = spec["f"] if f is None else f
    tiv = spec["tiv"] * tiv_mult
    per, total, total_gu = {}, 0.0, 0.0
    for p in PERILS:
        limit, ded = terms(spec, p)
        lam = frequency(spec, f, p)
        if p == "eq":
            m = _prod(f, EQ_INPUTS)
            ins = gu = 0.0
            for _, rate, dr in EQ_EVENTS:
                g = tiv * np.minimum(EQ_CAP, dr * m * _UNIT["eq"])
                gu += rate / EQ_RATE * g.mean()
                ins += rate / EQ_RATE * insured(g, limit, ded).mean()
        else:
            g = tiv * _UNIT[p]
            gu, ins = g.mean(), insured(g, limit, ded).mean()
        per[p] = {"freq": lam, "damage_ratio": gu / tiv, "sev_insured": ins, "sev_ground_up": gu,
                  "aal": lam * ins, "aal_ground_up": lam * gu, "limit": limit, "ded": ded}
        total += lam * ins
        total_gu += lam * gu
    return {"per": per, "total": total, "total_ground_up": total_gu, "tiv": tiv}


# ----------------------------------------------------------------------------------------------- 2. input uncertainty
def _seed(text: str, salt: int = 0) -> int:
    return (zlib.crc32(text.encode()) + salt) % (2**32)


def uncertainty(spec: dict, draws: int = 1500, seed: int | None = None, bins: int = 15) -> dict:
    """Draw every open input from triangular(lo, value, hi); return the spread of expected loss and what drives it.

    The driver measure is the first-order Sobol index, Var(E[loss | input]) / Var(loss), estimated by sorting the
    draws on one input, cutting them into equal bins and taking the variance of the bin means.
    """
    rng = np.random.default_rng(_seed(spec["id"], 7) if seed is None else seed)
    opens = spec["open"]
    X = np.empty((len(opens), draws))
    for j, u in enumerate(opens):
        X[j] = rng.triangular(u["lo"], min(max(u["v"], u["lo"]), u["hi"]), u["hi"], draws) if u["hi"] > u["lo"] else u["v"]
    out = np.empty(draws)
    for k in range(draws):
        f, tm = dict(spec["f"]), 1.0
        for j, u in enumerate(opens):
            if u.get("tiv"):
                tm *= X[j, k]
            else:
                f[u["k"]] = X[j, k]
        out[k] = aal(spec, f, tm)["total"]
    var = out.var()
    drivers = []
    for j, u in enumerate(opens):
        if var == 0:
            s = 0.0
        else:
            means = np.array([chunk.mean() for chunk in np.array_split(out[np.argsort(X[j])], bins)])
            s = max(0.0, ((means - out.mean()) ** 2).mean() / var - (bins - 1) / draws)
        drivers.append({**u, "sobol": s})
    tot = sum(d["sobol"] for d in drivers) or 1.0
    for d in drivers:
        d["share"] = d["sobol"] / max(tot, 1.0)
    drivers.sort(key=lambda d: -d["sobol"])
    p10, p50, p90 = np.percentile(out, [10, 50, 90])
    return {"draws": out, "mean": out.mean(), "sd": out.std(), "p10": p10, "p50": p50, "p90": p90,
            "drivers": drivers, "explained": min(1.0, tot)}


# ----------------------------------------------------------------------------------------------- 3. simulated years
def simulate(specs: list[dict], years: int = 100_000, seed: int = 206, pick: str = "v") -> dict:
    """Simulate annual insured loss for each property over the same years.

    Earthquake events and fire weather are drawn once per year for the whole region, so those losses line up
    across properties. Everything else is independent. `pick` sets the open inputs to their worksheet value
    ("v"), favourable end ("lo") or unfavourable end ("hi").
    """
    region = np.random.default_rng(seed)
    u = region.random(years)
    edges = np.cumsum([e[1] for e in EQ_EVENTS])
    eq_event = np.where(u < edges[-1], np.searchsorted(edges, u, side="right"), -1)   # -1 = no event this year
    weather = np.where(region.random(years) < WX_P, WX_BAD, WX_GOOD)

    props = []
    for spec in specs:
        rng = np.random.default_rng(_seed(spec["id"], seed))   # own stream: the same alone or in a portfolio
        f, tm = dict(spec["f"]), 1.0
        if pick != "v":
            for o in spec["open"]:
                x = o["lo"] if pick == "lo" else o["hi"]
                if o.get("tiv"):
                    tm *= x
                else:
                    f[o["k"]] = x
        tiv = spec["tiv"] * tm
        loss, per = np.zeros(years), {}
        for p in ("flood", "fire", "water", "wildfire"):
            limit, ded = terms(spec, p)
            lam = frequency(spec, f, p)
            counts = rng.poisson(lam * weather if p == "wildfire" else lam, years)
            total = np.zeros(years)
            for k in range(int(counts.max())):               # k-th occurrence in the years that have one
                hit = counts > k
                total[hit] += insured(tiv * _draw_damage(rng, p, int(hit.sum())), limit, ded)
            per[p] = total.mean()
            loss += total
        limit, ded = terms(spec, "eq")
        hit = eq_event >= 0
        dr = np.array([e[2] for e in EQ_EVENTS])[eq_event[hit]] * _prod(f, EQ_INPUTS) * _draw_damage(rng, "eq", int(hit.sum()))
        eq_loss = np.zeros(years)
        eq_loss[hit] = insured(tiv * np.minimum(EQ_CAP, dr), limit, ded)
        per["eq"] = eq_loss.mean()
        props.append({"id": spec["id"], "loss": loss + eq_loss, "per": per})
    return {"years": years, "props": props, "total": np.sum([p["loss"] for p in props], axis=0),
            "eq_event": eq_event, "weather": weather}


def metrics(loss: np.ndarray) -> dict:
    """Expected loss, exceedance curve and tail measures from simulated annual losses."""
    s = np.sort(loss)
    n = len(s)
    at = lambda rp: float(s[min(n - 1, max(0, int(np.ceil(n * (1 - 1 / rp))) - 1))])
    worst = max(1, round(n * 0.01))
    return {"aal": float(loss.mean()), "p_any": float((loss > 0).mean()),
            "ep": [(rp, at(rp)) for rp in RETURN_PERIODS],
            "pml100": at(100), "pml250": at(250), "tvar99": float(s[-worst:].mean()), "max": float(s[-1])}


def allocation(sim: dict) -> dict:
    """Each property's average loss in the portfolio's worst 1% of years (co-TVaR). The shares add up to portfolio TVaR."""
    worst = max(1, round(sim["years"] * 0.01))
    idx = np.argsort(sim["total"])[-worst:]
    co = {p["id"]: float(p["loss"][idx].mean()) for p in sim["props"]}
    alone = {p["id"]: metrics(p["loss"])["tvar99"] for p in sim["props"]}
    return {"co_tvar": co, "standalone_tvar": alone, "tvar99": float(sim["total"][idx].mean()),
            "sum_standalone": sum(alone.values()),
            "tail_with_earthquake": float((sim["eq_event"][idx] >= 0).mean()),
            "tail_bad_fire_weather": float((sim["weather"][idx] > 1).mean())}


# ----------------------------------------------------------------------------------------------- command line
def load_demo_specs() -> list[dict]:
    """The four synthetic properties from the web demo."""
    return json.loads((Path(__file__).with_name("reference_js.json")).read_text())["specs"]


def _usd(x: float) -> str:
    return f"${x:,.0f}"


def main() -> None:
    specs = load_demo_specs()
    sim = simulate(specs)
    print("Illustrative parameters; not fitted to loss data.\n")
    print(f"{'Property':24}{'Expected loss':>15}{'80% range':>22}{'1-in-100':>12}{'1-in-250':>12}{'TVaR 99%':>12}  Top driver of uncertainty")
    for spec, p in zip(specs, sim["props"]):
        a, m, u = aal(spec), metrics(p["loss"]), uncertainty(spec)
        top = u["drivers"][0]
        print(f"{spec['name']:24}{_usd(a['total']):>15}{_usd(u['p10']) + ' - ' + _usd(u['p90']):>22}{_usd(m['pml100']):>12}{_usd(m['pml250']):>12}{_usd(m['tvar99']):>12}  {top['label']} ({top['share']:.0%})")
    print("\nExpected loss by peril")
    print(f"{'Property':24}" + "".join(f"{PERIL_LABEL[p]:>17}" for p in PERILS))
    for spec in specs:
        a = aal(spec)
        print(f"{spec['name']:24}" + "".join(f"{_usd(a['per'][p]['aal']):>17}" for p in PERILS))
    pm, al = metrics(sim["total"]), allocation(sim)
    print(f"\nPortfolio: expected loss {_usd(pm['aal'])}, 1-in-100 {_usd(pm['pml100'])}, 1-in-250 {_usd(pm['pml250'])}, TVaR 99% {_usd(pm['tvar99'])}")
    print(f"Diversification benefit {1 - al['tvar99'] / al['sum_standalone']:.0%} "
          f"({_usd(al['sum_standalone'])} held alone, {_usd(al['tvar99'])} together); "
          f"{al['tail_with_earthquake']:.0%} of the worst 1% of years include an earthquake")
    print("Share of the portfolio tail: " + ", ".join(f"{k} {v / al['tvar99']:.0%}" for k, v in sorted(al["co_tvar"].items(), key=lambda kv: -kv[1])))


if __name__ == "__main__":
    main()
