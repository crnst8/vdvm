#include "Pattern.h"
#include "Json.h"

#include <ctime>

namespace drums
{
int clampBpm (double bpm)
{
    if (! std::isfinite (bpm))
        return bpmDefault;
    return (int) std::clamp (jsRound (bpm), (double) bpmMin, (double) bpmMax);
}

int clampSwing (double swing)
{
    if (! std::isfinite (swing))
        return 50;
    return (int) std::clamp (jsRound (swing), 50.0, 75.0);
}

double clampTrackGain (double db)
{
    if (! std::isfinite (db) || db < trackGainMinDb)
        return -INFINITY;
    return std::min (trackGainMaxDb, jsRound (db * 2) / 2);
}

double clampLevel (double x)
{
    if (! std::isfinite (x))
        return 1;
    return std::clamp (jsRound (x * 100) / 100, 0.0, 1.0);
}

double hitGainDb (const TrackState& track, int step)
{
    const double level = step < 0 || step >= steps ? 1.0 : track.levels[(size_t) step];
    if (level <= 0 || track.gainDb == -INFINITY)
        return -INFINITY;
    return track.gainDb + 40 * std::log10 (level);
}

int hitPitchCents (const PatternState& p, const TrackState* track, int step)
{
    if (step < 0 || step >= steps || track == nullptr)
        return p.pitchCents;
    return p.pitchCents + track->stepPitchCents[(size_t) step];
}

PatternState newPatternState (const KitManifest& kit, const juce::String& id)
{
    PatternState s;
    s.id = id;
    s.kitId = kit.id;
    s.kitRevision = kit.revision;
    return bindKit (s, kit);
}

PatternState bindKit (PatternState state, const KitManifest& kit)
{
    for (const auto& slot : kit.slots)
    {
        auto it = state.tracks.find (slot.id);
        if (it == state.tracks.end())
        {
            TrackState t;
            t.slotId = slot.id;
            t.sampleId = slot.defaultSampleId;
            state.tracks[slot.id] = t;
        }
        else if (! slot.sampleIds.contains (it->second.sampleId) && state.kitId != kit.id)
        {
            // Kit switch: the previous kit's sample cannot play here. Keep steps, use this kit's default.
            it->second.sampleId = slot.defaultSampleId;
        }
    }
    state.kitId = kit.id;
    state.kitRevision = kit.revision;
    return state;
}

juce::var toPatternJson (const PatternState& s)
{
    auto o = makeObject();
    setProp (o, "schemaVersion", 1);
    setProp (o, "id", s.id);
    setProp (o, "name", s.name);
    setProp (o, "kitId", s.kitId);
    setProp (o, "kitRevision", s.kitRevision);
    setProp (o, "bpm", s.bpm);
    if (s.length != 16)
        setProp (o, "length", s.length);
    if (s.swing != 50)
        setProp (o, "swing", s.swing);
    if (s.swingGrid != 16)
        setProp (o, "swingGrid", s.swingGrid);
    if (s.circuit)
        setProp (o, "circuit", true);
    if (s.pitchCents != 0)
        setProp (o, "pitchCents", s.pitchCents);
    juce::Array<juce::var> tracks;
    for (const auto& [slotId, t] : s.tracks) // std::map: sorted by slotId, like toPattern
    {
        auto tr = makeObject();
        setProp (tr, "slotId", t.slotId);
        setProp (tr, "sampleId", t.sampleId);
        juce::Array<juce::var> stepsArr, levels, pitches;
        bool anyLevel = false, anyPitch = false;
        for (int i = 0; i < steps; ++i)
        {
            stepsArr.add (t.stepsOn[(size_t) i]);
            levels.add (t.levels[(size_t) i]);
            pitches.add (t.stepPitchCents[(size_t) i]);
            anyLevel |= t.levels[(size_t) i] != 1.0;
            anyPitch |= t.stepPitchCents[(size_t) i] != 0;
        }
        setProp (tr, "steps", stepsArr);
        if (t.gainDb != 0)
            setProp (tr, "gainDb", t.gainDb == -INFINITY ? -60.0 : t.gainDb);
        if (anyLevel)
            setProp (tr, "levels", levels);
        if (anyPitch)
            setProp (tr, "stepPitchCents", pitches);
        tracks.add (tr);
    }
    setProp (o, "tracks", tracks);
    setProp (o, "updatedAt", s.updatedAt.isNotEmpty() ? s.updatedAt : isoNow());
    return o;
}

std::optional<PatternState> fromPatternJson (const juce::var& p)
{
    if (p.getDynamicObject() == nullptr || (int) p["schemaVersion"] != 1 || ! p["id"].isString() || ! p["kitId"].isString()
        || ! (p["bpm"].isInt() || p["bpm"].isDouble() || p["bpm"].isInt64()) || ! p["tracks"].isArray())
        return std::nullopt;
    PatternState s;
    s.id = p["id"].toString();
    s.name = p["name"].isString() && p["name"].toString().isNotEmpty() ? p["name"].toString() : juce::String ("UNTITLED");
    s.kitId = p["kitId"].toString();
    s.kitRevision = p["kitRevision"].toString();
    s.bpm = clampBpm ((double) p["bpm"]);
    s.length = (int) p["length"] == 8 ? 8 : 16;
    const auto& sw = p["swing"];
    s.swing = (sw.isInt() || sw.isDouble() || sw.isInt64()) ? clampSwing ((double) sw) : 50;
    s.swingGrid = (int) p["swingGrid"] == 8 ? 8 : 16;
    s.circuit = p["circuit"].isBool() && (bool) p["circuit"];
    const auto& pc = p["pitchCents"];
    s.pitchCents = (pc.isInt() || pc.isDouble() || pc.isInt64()) ? clampPitchCents ((double) pc) : 0;
    s.updatedAt = p["updatedAt"].toString();
    for (const auto& t : *p["tracks"].getArray())
    {
        if (! t["slotId"].isString() || ! t["sampleId"].isString() || ! t["steps"].isArray())
            return std::nullopt;
        TrackState tr;
        tr.slotId = t["slotId"].toString();
        tr.sampleId = t["sampleId"].toString();
        const auto* st = t["steps"].getArray();
        const auto* lv = t["levels"].getArray();
        const auto* sp = t["stepPitchCents"].getArray();
        for (int i = 0; i < steps; ++i)
        {
            tr.stepsOn[(size_t) i] = i < st->size() && st->getReference (i).isBool() && (bool) st->getReference (i);
            tr.levels[(size_t) i] = lv != nullptr && i < lv->size() ? clampLevel ((double) lv->getReference (i)) : 1.0;
            if (sp != nullptr && i < sp->size())
            {
                const auto& v = sp->getReference (i);
                tr.stepPitchCents[(size_t) i] = (v.isInt() || v.isDouble() || v.isInt64()) ? clampPitchCents ((double) v) : 0;
            }
        }
        const auto& g = t["gainDb"];
        tr.gainDb = (g.isInt() || g.isDouble() || g.isInt64()) ? clampTrackGain ((double) g) : 0.0;
        s.tracks[tr.slotId] = tr;
    }
    return s;
}

juce::String newPatternId()
{
    return juce::Uuid().toDashedString();
}

juce::String isoNow()
{
    const auto ms = juce::Time::currentTimeMillis();
    const std::time_t secs = (std::time_t) (ms / 1000);
    std::tm utc {};
#if JUCE_WINDOWS
    gmtime_s (&utc, &secs);
#else
    gmtime_r (&secs, &utc);
#endif
    char buf[40];
    std::snprintf (buf, sizeof buf, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday,
                   utc.tm_hour, utc.tm_min, utc.tm_sec, (int) (ms % 1000));
    return buf;
}
} // namespace drums
