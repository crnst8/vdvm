// JSON helpers over juce::var: canonical encoding (byte-identical to
// src/contract/canonical.ts, so revisions match the TypeScript build), pretty
// output for files, and typed field readers that report what is wrong.
#pragma once

#include <juce_core/juce_core.h>
#include <optional>
#include <string>

namespace drums
{
/** Number formatted as JavaScript's Number#toString (shortest round-trip). */
std::string jsNumber (double value);

/** JSON.stringify string quoting. Input is UTF-8; output is UTF-8. */
std::string jsQuote (const juce::String& s);

/** Compact JSON, object keys sorted recursively, root `revision` omitted when asked. */
std::string canonicalJson (const juce::var& value, bool omitRootRevision = true);

/** First 16 hex chars of SHA-256 over canonicalJson(value). */
juce::String revisionOf (const juce::var& value);

/** Full lowercase hex SHA-256. */
juce::String sha256Hex (const void* data, size_t size);
juce::String sha256Hex (const juce::File& file);

/** Indented JSON with recursively sorted keys and a trailing newline (like lib.ts stableJson). */
juce::String stableJson (const juce::var& value);

/** Parse JSON text; nullopt and `error` on failure. */
std::optional<juce::var> parseJson (const juce::String& text, juce::String& error);

/** Atomic write: temp file in the same folder, then rename. */
bool writeFileAtomic (const juce::File& file, const juce::String& text);
bool writeFileAtomic (const juce::File& file, const juce::MemoryBlock& data);

// Typed readers. Each returns false and appends to `errors` when the field is absent or the wrong type.
struct FieldReader
{
    const juce::var& obj;
    juce::String where;
    juce::StringArray& errors;

    bool has (const char* key) const;
    juce::String string (const char* key, bool required = true) const;
    double number (const char* key, double fallback, bool required = true) const;
    int integer (const char* key, int fallback, bool required = true) const;
    bool boolean (const char* key, bool fallback, bool required = true) const;
    const juce::var& array (const char* key, bool required = true) const;
    const juce::var& object (const char* key, bool required = true) const;
};

juce::var makeObject();
void setProp (juce::var& obj, const juce::String& key, const juce::var& value);
} // namespace drums
