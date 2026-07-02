function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function smoothstep(t) { return t * t * (3 - 2 * t); }

function baselineIntervalMinFromDevValueUSD(valueUSD, { minIntervalMin, maxIntervalMin, pivotUsd }) {
  const MIN = minIntervalMin;
  const MAX = maxIntervalMin;
  const PIVOT = Math.max(pivotUsd, 0.01);

  const x = Math.log10(Math.max(valueUSD, 0.01));
  const pivotX = Math.log10(PIVOT);
  const t = clamp(x / pivotX, 0, 1);
  const s = smoothstep(t);

  return clamp(MIN + s * (MAX - MIN), MIN, MAX);
}

/**
 * precedence:
 * 1) launch safety window (time-based)
 * 2) value-based baseline (dev wallet usd value)
 * 3) spike modifier (dev value delta)
 * 4) clamp
 */
function computeCadenceMs({ nowMs, launchTsMs, devValueUSD, lastDevValueUSD, launch, cadence }) {
  const uptimeHours = (nowMs - launchTsMs) / (60 * 60 * 1000);

  if (uptimeHours < launch.safetyHours) {
    const mins = clamp(launch.intervalMin, cadence.minIntervalMin, cadence.maxIntervalMin);
    return { delayMs: mins * 60_000, spike: false, baselineMin: mins };
  }

  let intervalMin = baselineIntervalMinFromDevValueUSD(devValueUSD, cadence);
  const baselineMin = intervalMin;

  let spike = false;
  if (Number.isFinite(lastDevValueUSD) && lastDevValueUSD > 0) {
    const deltaUSD = devValueUSD - lastDevValueUSD;
    const deltaPct = deltaUSD / lastDevValueUSD;
    spike = (deltaUSD >= cadence.spikeUsd) || (deltaPct >= cadence.spikePct);
    if (spike) intervalMin = intervalMin * cadence.spikeIntervalMult;
  }

  intervalMin = clamp(intervalMin, cadence.minIntervalMin, cadence.maxIntervalMin);
  return { delayMs: Math.round(intervalMin) * 60_000, spike, baselineMin };
}

module.exports = { computeCadenceMs, baselineIntervalMinFromDevValueUSD };
