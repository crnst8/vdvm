// V.D.V.M catalog contract v1 (catalog/schema/*.schema.json) as C++ structs,
// with the reference checks of src/contract/semantic.ts, URL safety of
// src/contract/urls.ts and redirect resolution of src/contract/redirects.ts.
// Parsing keeps the original juce::var so files can be re-validated or copied.
#pragma once

#include <juce_core/juce_core.h>
#include <map>
#include <optional>
#include <vector>

namespace drums
{
inline constexpr int supportedSchemaMajor = 1;

bool isSafeRelativeUrl (const juce::String& rel);
bool isValidId (const juce::String& id);
bool isSha256 (const juce::String& s);

/** Path with symlinks resolved (POSIX realpath); unchanged on Windows. */
juce::File canonicalFile (const juce::File& f);

/** Resolve `rel` under `root`, refusing unsafe URLs and anything (including symlinks) that escapes root. */
std::optional<juce::File> resolveUnder (const juce::File& root, const juce::String& rel);

using RedirectMap = std::map<juce::String, juce::String>;
/** Follow a redirect chain. nullopt on a cycle. */
std::optional<juce::String> resolveRedirect (const RedirectMap& map, const juce::String& id);

struct AssetRef
{
    juce::String id, url, sha256, alt, creditId;
    int width = 0, height = 0;
};

struct Machine
{
    juce::String id, manufacturer, model, displayName, kind, identityStatus;
    std::optional<AssetRef> logo, photo;
};

struct KitEntry
{
    juce::String id, machineId, label, revision, url;
};

struct CatalogIndex
{
    int schemaVersion = 1;
    juce::String revision, creditsUrl;
    std::vector<Machine> machines;
    std::vector<KitEntry> kits;
    RedirectMap machineRedirects, kitRedirects, sampleRedirects;
    juce::var raw;

    const KitEntry* kitEntry (const juce::String& id) const; // follows redirects
    const Machine* machine (const juce::String& id) const;    // follows redirects
    juce::String resolveSampleId (const juce::String& id) const;
};

struct Sample
{
    juce::String id, label, blobSha256, url;
    juce::int64 bytes = 0;
    double durationSec = 0;
    int channels = 1;
    int sampleRate = 44100;
    double gainDb = 0;
    std::optional<double> peakDbfs;
};

struct Slot
{
    juce::String id, label, category, icon, defaultSampleId;
    juce::StringArray sampleIds;
    juce::String chokeGroup; // empty = null
    double gainDb = 0;
};

struct KitManifest
{
    int schemaVersion = 1;
    juce::String id, machineId, label, revision;
    std::vector<Slot> slots;
    std::vector<Sample> samples;
    juce::var raw;

    const Sample* sample (const juce::String& id) const;
    const Slot* slot (const juce::String& id) const;
};

/** Parse with structural checks (types, required fields, enums, ranges). Errors are appended. */
std::optional<CatalogIndex> parseIndex (const juce::var& json, juce::StringArray& errors);
std::optional<KitManifest> parseKit (const juce::var& json, juce::StringArray& errors);

/** Reference checks; same messages as src/contract/semantic.ts. */
juce::StringArray checkIndex (const CatalogIndex& index);
juce::StringArray checkKit (const KitManifest& kit, const KitEntry* entry = nullptr);

/** Serialise back to contract JSON (used when the plugin writes user libraries). */
juce::var toJson (const Sample& s);
juce::var toJson (const Slot& s);
juce::var toJson (const KitManifest& k);   // includes revision field as stored
juce::var toJson (const Machine& m);
juce::var toJson (const CatalogIndex& index);

/** Category and icon for a slot role id, as the curated catalog assigns them. */
juce::String categoryForRole (const juce::String& roleId);
juce::String iconForRole (const juce::String& roleId);
} // namespace drums
