// Importing arbitrary audio and editing user kits.
//
// scan()          lists supported one-shots in files/folders (bounded, cancellable,
//                 symlinked folders not followed) with header checks and a role
//                 suggestion from the file name. Suggestions are only suggestions.
// importSamples() copies (user library) or links (linked library) the chosen
//                 files after a full decode, hashes the stored bytes and records
//                 metadata measured from the audio, never invented.
// saveKit()       writes a v1 kit manifest from a draft (slots, variants,
//                 defaults, hat roles), rebuilds the library index and moves
//                 audio between pool/ (unassigned) and media/audio/ (in a kit),
//                 so the folder stays a strictly valid V.D.V.M catalog.
// copyKit()       copies a kit from any library into a user library.
// relink()        finds a linked library's files in a moved folder by path, then
//                 by size and content hash.
#pragma once

#include "Library.h"

#include <atomic>
#include <functional>

namespace drums
{
struct WavInfo
{
    bool pcm = true; // false: IEEE float
    int channels = 0, sampleRate = 0, bitsPerSample = 0;
    juce::int64 dataBytes = 0, frames = 0;
    double durationSec = 0;
};
/** Port of src/contract/wav.ts readWavInfo (what the catalog validator accepts). */
std::optional<WavInfo> readWavInfo (const void* data, size_t size, juce::String& error);

/** Suggested slot role for a file name ("" when nothing matches). */
juce::String suggestRole (const juce::String& fileName);
/** Roles offered in the kit editor, in panel order. */
const juce::StringArray& knownRoles();
juce::String labelForRole (const juce::String& role);
/** Lowercase kebab-case slug for ids. */
juce::String slugify (const juce::String& text, int maxLength = 48);

struct ScanLimits
{
    int maxCandidates = 4000;
    int maxEntries = 50000;
    int maxDepth = 12;
    int maxRejectedListed = 200;
    double maxDurationSec = 60;
    juce::int64 maxFileBytes = 512ll * 1024 * 1024;
};

struct ScanCandidate
{
    juce::File file;
    juce::String relPath; // relative to the scanned folder ('/' separated); file name for single files
    juce::String name, format, suggestedRole;
    int channels = 0;
    double sampleRate = 0, durationSec = 0;
    juce::int64 bytes = 0;
};

struct ScanRejected
{
    juce::File file;
    juce::String reason;
};

struct ScanResult
{
    juce::File folder; // set when a single folder was scanned (linking needs one root)
    std::vector<ScanCandidate> candidates;
    std::vector<ScanRejected> rejected;
    int rejectedTotal = 0;
    int examined = 0;
    bool truncated = false;
    bool cancelled = false;
};

ScanResult scanForAudio (const juce::Array<juce::File>& items, const ScanLimits& limits = {}, const std::atomic<bool>* cancel = nullptr,
                         const std::function<void (int examined, int found)>& progress = {});

struct ImportOutcome
{
    std::vector<ImportedSample> imported; // includes files already in the library (same content)
    std::vector<ScanRejected> failed;
    bool cancelled = false;
};

/** Copy (user) or link (linked) the candidates into the library. Linked candidates must lie inside its folder. */
ImportOutcome importSamples (LibraryManager& libraries, const juce::String& libraryId, const std::vector<ScanCandidate>& candidates,
                             const std::atomic<bool>* cancel = nullptr,
                             const std::function<void (int done, int total)>& progress = {});

struct SlotDraft
{
    juce::String id;    // existing slot id to keep, or empty
    juce::String role;  // known role or empty for a custom pad
    juce::String label;
    juce::StringArray sampleShas; // variants in order
    juce::String defaultSha;
};

struct KitDraft
{
    juce::String kitId; // empty = new kit
    juce::String label;
    std::vector<SlotDraft> slots;
};

/** Write the kit; returns its id (new or kept). Slots without samples are dropped; at least one must remain. */
juce::String saveKit (LibraryManager& libraries, const juce::String& libraryId, const KitDraft& draft, juce::String& error);
bool deleteKit (LibraryManager& libraries, const juce::String& libraryId, const juce::String& kitId, juce::String& error);
/** Remove imported samples not used by any kit. Returns how many were removed. */
int removeUnusedSamples (LibraryManager& libraries, const juce::String& libraryId, const juce::StringArray& shas, juce::String& error);

/** Copy a kit (audio included, hashes verified) from any library into a user library. Returns the new kit id. */
juce::String copyKit (LibraryManager& libraries, const juce::String& fromLibraryId, const juce::String& kitId,
                      const juce::String& toLibraryId, juce::String& error);

struct RelinkOutcome
{
    int found = 0;
    int missing = 0;
    juce::StringArray missingNames;
};
/** Point a linked library at `newRoot`, matching files by path, then by size and hash. */
RelinkOutcome relinkLibrary (LibraryManager& libraries, const juce::String& libraryId, const juce::File& newRoot,
                             juce::String& error, const std::atomic<bool>* cancel = nullptr);

struct LibraryHealth
{
    int kits = 0, samples = 0, missing = 0, changed = 0;
    juce::StringArray problems;
};
/** Check every sample of every kit is present (and, for linked files, unchanged by size and date). */
LibraryHealth checkLibrary (LibraryManager& libraries, const juce::String& libraryId);
} // namespace drums
