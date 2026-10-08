// Per-user files the plugin keeps outside DAW projects: saved patterns
// (Pattern v1, shared by every instance and both editions) and preferences
// (favourites, recents, library tab, output volume, last library). Writes are
// atomic; a damaged file is moved aside rather than overwritten silently.
#pragma once

#include <juce_core/juce_core.h>
#include <mutex>

namespace drums
{
class JsonFileStore
{
public:
    explicit JsonFileStore (juce::File file);
    juce::var read() const;
    bool write (const juce::var& value);
    const juce::File& file() const { return path; }

private:
    juce::File path;
    mutable std::mutex mutex;
};

class PatternStore
{
public:
    explicit PatternStore (juce::File file);
    /** Saved patterns, newest first. Entries that are not Pattern v1 are skipped. */
    juce::Array<juce::var> list() const;
    bool put (const juce::var& pattern);
    bool remove (const juce::String& id);

private:
    JsonFileStore store;
};

class PrefsStore
{
public:
    explicit PrefsStore (juce::File file);
    juce::var get() const;
    /** Merge `patch` (an object) into the stored preferences. */
    bool merge (const juce::var& patch);

private:
    JsonFileStore store;
};

/** Structural check used for saved patterns (src/data/patterns.ts isPattern). */
bool isPatternJson (const juce::var& p);
} // namespace drums
