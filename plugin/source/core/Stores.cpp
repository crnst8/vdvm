#include "Stores.h"
#include "Json.h"

namespace drums
{
JsonFileStore::JsonFileStore (juce::File f) : path (std::move (f)) {}

juce::var JsonFileStore::read() const
{
    std::lock_guard lock (mutex);
    if (! path.existsAsFile())
        return {};
    juce::String error;
    const auto parsed = parseJson (path.loadFileAsString(), error);
    if (! parsed)
    {
        // Keep the damaged file for the user instead of overwriting it on the next save.
        path.moveFileTo (path.getSiblingFile (path.getFileNameWithoutExtension() + ".damaged-"
                                              + juce::String (juce::Time::currentTimeMillis()) + path.getFileExtension()));
        return {};
    }
    return *parsed;
}

bool JsonFileStore::write (const juce::var& value)
{
    std::lock_guard lock (mutex);
    return writeFileAtomic (path, juce::JSON::toString (value, false));
}

bool isPatternJson (const juce::var& p)
{
    if (p.getDynamicObject() == nullptr || (int) p["schemaVersion"] != 1 || ! p["id"].isString() || ! p["kitId"].isString()
        || ! (p["bpm"].isInt() || p["bpm"].isDouble() || p["bpm"].isInt64()) || ! p["tracks"].isArray())
        return false;
    for (const auto& t : *p["tracks"].getArray())
        if (! t["slotId"].isString() || ! t["sampleId"].isString() || ! t["steps"].isArray())
            return false;
    return true;
}

PatternStore::PatternStore (juce::File file) : store (std::move (file)) {}

juce::Array<juce::var> PatternStore::list() const
{
    juce::Array<juce::var> out;
    const auto data = store.read();
    if (const auto* arr = data["patterns"].getArray())
        for (const auto& p : *arr)
            if (isPatternJson (p))
                out.add (p);
    std::stable_sort (out.begin(), out.end(), [] (const juce::var& a, const juce::var& b)
    {
        return a["updatedAt"].toString() > b["updatedAt"].toString();
    });
    return out;
}

bool PatternStore::put (const juce::var& pattern)
{
    if (! isPatternJson (pattern))
        return false;
    auto all = list();
    const auto id = pattern["id"].toString();
    all.removeIf ([&] (const juce::var& p) { return p["id"].toString() == id; });
    all.add (pattern);
    auto root = makeObject();
    setProp (root, "format", "vdvm-plugin-patterns");
    setProp (root, "version", 1);
    setProp (root, "patterns", all);
    return store.write (root);
}

bool PatternStore::remove (const juce::String& id)
{
    auto all = list();
    all.removeIf ([&] (const juce::var& p) { return p["id"].toString() == id; });
    auto root = makeObject();
    setProp (root, "format", "vdvm-plugin-patterns");
    setProp (root, "version", 1);
    setProp (root, "patterns", all);
    return store.write (root);
}

PrefsStore::PrefsStore (juce::File file) : store (std::move (file)) {}

juce::var PrefsStore::get() const
{
    auto v = store.read();
    return v.getDynamicObject() != nullptr ? v : makeObject();
}

bool PrefsStore::merge (const juce::var& patch)
{
    auto current = get();
    if (auto* p = patch.getDynamicObject())
        for (const auto& kv : p->getProperties())
            setProp (current, kv.name.toString(), kv.value);
    return store.write (current);
}
} // namespace drums
