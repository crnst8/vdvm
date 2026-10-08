#include "Timing.h"

#include <DrumsSharedData.h>
#include <cmath>

namespace drums
{
const juce::var& sharedData()
{
    static const juce::var data = juce::JSON::parse (juce::String::fromUTF8 (DrumsShared::shared_json, DrumsShared::shared_jsonSize));
    return data;
}

namespace
{
    std::map<juce::String, CircuitProfile> loadCircuits()
    {
        std::map<juce::String, CircuitProfile> out;
        auto* obj = sharedData()["circuits"].getDynamicObject();
        if (obj == nullptr)
            return out;
        for (const auto& p : obj->getProperties())
        {
            CircuitProfile c;
            c.summary = p.value["summary"].toString();
            if (auto* grids = p.value["swing"]["grids"].getDynamicObject())
            {
                for (const auto& g : grids->getProperties())
                {
                    SwingSteps s;
                    if (g.value["kind"].toString() == "values")
                    {
                        s.kind = SwingSteps::Kind::values;
                        for (const auto& v : *g.value["values"].getArray())
                            s.values.push_back ((double) v);
                    }
                    else
                    {
                        s.divisions = (int) g.value["divisions"];
                        s.maxSteps = (int) g.value["maxSteps"];
                    }
                    c.swingGrids[g.name.toString().getIntValue()] = s;
                }
            }
            const auto& j = p.value["jitter"];
            if (j.getDynamicObject() != nullptr)
            {
                JitterProfile jp;
                jp.kind = j["kind"].toString() == "poll" ? JitterProfile::Kind::poll : JitterProfile::Kind::measured;
                jp.maxMs = (double) j["maxMs"];
                jp.pollMs = (double) j["pollMs"];
                if (! j["meanMs"].isVoid())
                    jp.meanMs = (double) j["meanMs"];
                c.jitter = jp;
            }
            out[p.name.toString()] = c;
        }
        return out;
    }
} // namespace

const CircuitProfile* circuitFor (const juce::String& machineId)
{
    static const auto circuits = loadCircuits();
    const auto it = circuits.find (machineId);
    return it == circuits.end() ? nullptr : &it->second;
}

double machineSwing (double requested, const SwingSteps* steps)
{
    if (steps == nullptr || requested <= 50)
        return std::max (50.0, requested);
    if (steps->kind == SwingSteps::Kind::values)
    {
        double best = steps->values.front();
        for (double v : steps->values)
            if (std::abs (v - requested) < std::abs (best - requested))
                best = v;
        return best;
    }
    const double unit = 100.0 / steps->divisions;
    const double k = std::min ((double) steps->maxSteps, std::max (0.0, std::floor ((requested - 50) / unit + 0.5)));
    return 50 + k * unit;
}

StepJitter::StepJitter (const JitterProfile& p, juce::uint64 seed) : profile (p), rng (seed)
{
    pollPhaseMs = p.kind == JitterProfile::Kind::poll ? rng.next() * p.pollMs : 0;
}

double StepJitter::offsetSec (double whenSec)
{
    const auto& p = profile;
    if (p.kind == JitterProfile::Kind::measured)
    {
        // Shape u^k so the mean matches the published average: mean = max / (k + 1).
        const double k = p.meanMs && *p.meanMs > 0 && *p.meanMs < p.maxMs ? p.maxMs / *p.meanMs - 1 : 1;
        return p.maxMs * std::pow (rng.next(), k) / 1000.0;
    }
    const double tMs = whenSec * 1000 + pollPhaseMs;
    const double toNextPoll = std::fmod (p.pollMs - std::fmod (tMs, p.pollMs), p.pollMs);
    const double cpu = rng.next() * std::max (0.0, p.maxMs - p.pollMs);
    return std::min (p.maxMs, toNextPoll + cpu) / 1000.0;
}

const std::map<juce::String, int>& gmNotes()
{
    static const auto notes = []
    {
        std::map<juce::String, int> out;
        if (auto* obj = sharedData()["gmNotes"].getDynamicObject())
            for (const auto& p : obj->getProperties())
                out[p.name.toString()] = (int) p.value;
        return out;
    }();
    return notes;
}
} // namespace drums
