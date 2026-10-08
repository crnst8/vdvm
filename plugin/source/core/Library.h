// Libraries: where sounds come from. One subsystem serves both editions.
//
// Kinds:
// - factory: the curated V.D.V.M catalog an installer put in a conventional
//   folder (auto-discovered, read-only). The unbundled edition has none.
// - catalog: any other V.D.V.M-format catalog folder the user added (read-only,
//   loaded in place, never modified).
// - user: a managed library the plugin writes. Imported audio is copied (and
//   converted to WAV) into it, so it keeps working when the source folder
//   moves. It is itself a valid V.D.V.M v1 catalog folder.
// - linked: like user, but audio stays in an external folder the user chose;
//   files are found through links.json and must be relinked if moved.
//
// Identity is libraryId + kitId (+ revision), never an absolute path. The
// registry of locations is a per-user preference; projects store a library
// reference and resolve it through findKit().
#pragma once

#include "Contract.h"

#include <memory>
#include <mutex>

namespace drums
{
enum class LibraryKind { factory, catalog, user, linked };
juce::String toString (LibraryKind k);
std::optional<LibraryKind> libraryKindFrom (const juce::String& s);

struct LibraryRecord
{
    juce::String id;
    LibraryKind kind = LibraryKind::catalog;
    juce::String name;
    juce::File root;       // catalog root (contains catalog/index.json)
    juce::File linkedRoot; // linked libraries: the external audio folder
    juce::String addedAt;
    bool discovered = false; // factory found by convention, not stored in the registry
};

struct LinkEntry
{
    juce::String path; // relative to linkedRoot, '/' separated
    juce::int64 bytes = 0;
    juce::int64 modifiedMs = 0;
};

/** Metadata for audio imported into a user or linked library (samples.json). */
struct ImportedSample
{
    juce::String sha256, name, originalPath, format, suggestedRole, importedAt;
    int channels = 0, sampleRate = 0;
    double durationSec = 0;
    juce::int64 bytes = 0;
    std::optional<double> peakDbfs;
};

class Library
{
public:
    static std::shared_ptr<Library> open (const LibraryRecord& record, juce::String& error);

    const LibraryRecord& record() const { return rec; }
    const CatalogIndex& index() const { return idx; }
    bool writable() const { return rec.kind == LibraryKind::user || rec.kind == LibraryKind::linked; }

    /** Load, validate and cache a kit manifest (follows kit redirects). */
    std::optional<KitManifest> loadKit (const juce::String& kitId, juce::String& error) const;
    /** The file holding a sample's audio, confined to the library (or linked) root. */
    std::optional<juce::File> sampleFile (const Sample& s) const;
    /** A catalog-relative file for the UI (index, kits, credits, logos, photos). */
    std::optional<juce::File> resourceFile (const juce::String& rel) const;

    /** Linked libraries: link table. */
    const std::map<juce::String, LinkEntry>& links() const { return linkTable; }
    /** User/linked libraries: imported samples (assigned or not). */
    const std::map<juce::String, ImportedSample>& imported() const { return importedTable; }

private:
    LibraryRecord rec;
    CatalogIndex idx;
    std::map<juce::String, LinkEntry> linkTable;
    std::map<juce::String, ImportedSample> importedTable;
    mutable std::mutex cacheMutex;
    mutable std::map<juce::String, KitManifest> kitCache;
};

struct KitLocation
{
    juce::String libraryId;
    KitEntry entry;
    bool exactRevision = false;
};

class LibraryManager
{
public:
    /**
     * dataDir holds library-registry.json and the default location for new user libraries.
     * factoryDirs are checked in order for an installed factory catalog.
     */
    LibraryManager (juce::File dataDir, std::vector<juce::File> factoryDirs);

    static juce::File defaultDataDir();
    static std::vector<juce::File> defaultFactoryDirs();
    /**
     * Move the pre-rename data folder ("Drums") to the V.D.V.M folder once, rewriting registered
     * paths inside it. Does nothing when the new folder exists or VDVM_DATA_DIR is set.
     */
    static bool migrateLegacyDataDir();
    static bool migrateDataDir (const juce::File& from, const juce::File& to);

    void refresh();
    std::vector<LibraryRecord> records() const;
    std::optional<LibraryRecord> record (const juce::String& id) const;
    /** Open (cached) library; null with error when missing or invalid. */
    std::shared_ptr<Library> get (const juce::String& id, juce::String& error);
    /** Drop the cached copy after a write so the next get() rereads it. */
    void invalidate (const juce::String& id);

    juce::String addCatalog (const juce::File& root, juce::String& error);
    juce::String createUserLibrary (const juce::String& name, juce::String& error, const juce::File& location = {});
    juce::String createLinkedLibrary (const juce::String& name, const juce::File& linkedRoot, juce::String& error);
    /** Register an existing user/linked library folder (e.g. copied from another machine). */
    juce::String addExistingUserLibrary (const juce::File& root, juce::String& error);
    bool remove (const juce::String& id, juce::String& error);
    bool rename (const juce::String& id, const juce::String& name, juce::String& error);
    /** Point a library at a moved folder (catalog/user root, or a linked library's audio folder). */
    bool relocate (const juce::String& id, const juce::File& newRoot, juce::String& error);

    /**
     * Resolve a project's kit reference: the named library (any revision), else any library
     * holding the identical kit (same id and revision). Otherwise nothing: the caller shows
     * the missing-library state instead of binding another kit.
     */
    std::optional<KitLocation> findKit (const juce::String& preferredLibraryId, const juce::String& kitId,
                                        const juce::String& revision);

    const juce::File& dataDirectory() const { return dataDir; }
    juce::File userLibrariesDirectory() const { return dataDir.getChildFile ("User Libraries"); }

private:
    void saveRegistryLocked() const;
    juce::String uniqueIdLocked (const juce::String& base) const;

    juce::File dataDir;
    std::vector<juce::File> factoryDirs;
    mutable std::mutex mutex;
    std::vector<LibraryRecord> recs;
    std::map<juce::String, std::shared_ptr<Library>> opened;
};

/**
 * The catalog root for a folder the user chose: the folder itself, its parent when they picked
 * the catalog/ folder, or a built public/ inside or beside it (a source checkout of the project).
 */
std::optional<juce::File> findCatalogRoot (const juce::File& chosen);

/** Read library.json of a user/linked library folder. */
std::optional<LibraryRecord> readLibraryFile (const juce::File& root, juce::String& error);
bool writeLibraryFile (const LibraryRecord& rec);
} // namespace drums
