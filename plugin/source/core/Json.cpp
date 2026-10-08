#include "Json.h"

#include <juce_cryptography/juce_cryptography.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace drums
{
std::string jsNumber (double v)
{
    if (! std::isfinite (v))
        return "null"; // canonical encoding rejects these before reaching here
    if (v == 0.0)
        return "0"; // -0 prints as 0 in JavaScript
    // Shortest scientific digits that round-trip.
    char buf[64];
    int precision = 1;
    for (; precision <= 17; ++precision)
    {
        std::snprintf (buf, sizeof buf, "%.*e", precision - 1, v);
        if (std::strtod (buf, nullptr) == v)
            break;
    }
    std::string sci (buf);
    const bool negative = sci[0] == '-';
    if (negative)
        sci.erase (0, 1);
    const auto ePos = sci.find ('e');
    std::string mantissa = sci.substr (0, ePos);
    const int exponent = std::atoi (sci.c_str() + ePos + 1);
    std::string digits;
    for (char c : mantissa)
        if (c != '.')
            digits += c;
    while (digits.size() > 1 && digits.back() == '0')
        digits.pop_back();
    const int k = (int) digits.size();
    const int n = exponent + 1; // decimal point position, per ECMA-262 Number::toString
    std::string out;
    if (k <= n && n <= 21)
    {
        out = digits + std::string ((size_t) (n - k), '0');
    }
    else if (0 < n && n <= 21)
    {
        out = digits.substr (0, (size_t) n) + "." + digits.substr ((size_t) n);
    }
    else if (-6 < n && n <= 0)
    {
        out = "0." + std::string ((size_t) -n, '0') + digits;
    }
    else
    {
        const int e = n - 1;
        const std::string expPart = std::string (e >= 0 ? "+" : "-") + std::to_string (std::abs (e));
        out = k == 1 ? digits + "e" + expPart : digits.substr (0, 1) + "." + digits.substr (1) + "e" + expPart;
    }
    return negative ? "-" + out : out;
}

std::string jsQuote (const juce::String& s)
{
    std::string out = "\"";
    const std::string utf8 = s.toStdString();
    for (unsigned char c : utf8)
    {
        switch (c)
        {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20)
                {
                    char esc[8];
                    std::snprintf (esc, sizeof esc, "\\u%04x", c);
                    out += esc;
                }
                else
                {
                    out += (char) c;
                }
        }
    }
    out += "\"";
    return out;
}

namespace
{
    void encode (const juce::var& v, bool omitRevision, std::string& out, bool sorted, int indent, int depth)
    {
        const auto newline = [&] (int d)
        {
            if (indent > 0)
            {
                out += "\n";
                out += std::string ((size_t) (indent * d), ' ');
            }
        };
        if (v.isUndefined())
            throw std::runtime_error ("canonicalJson: undefined value");
        if (v.isVoid())
        {
            out += "null"; // the JSON parser reads null as a void var
            return;
        }
        if (auto* obj = v.getDynamicObject())
        {
            std::vector<std::pair<std::string, juce::var>> entries;
            for (const auto& p : obj->getProperties())
            {
                const auto key = p.name.toString();
                if (omitRevision && key == "revision")
                    continue;
                if (p.value.isUndefined())
                    continue;
                entries.emplace_back (key.toStdString(), p.value);
            }
            if (sorted)
                std::sort (entries.begin(), entries.end(), [] (const auto& a, const auto& b) { return a.first < b.first; });
            out += "{";
            bool first = true;
            for (const auto& [k, val] : entries)
            {
                if (! first)
                    out += ",";
                first = false;
                newline (depth + 1);
                out += jsQuote (juce::String::fromUTF8 (k.c_str()));
                out += indent > 0 ? ": " : ":";
                encode (val, false, out, sorted, indent, depth + 1);
            }
            if (! entries.empty())
                newline (depth);
            out += "}";
            return;
        }
        if (auto* arr = v.getArray())
        {
            out += "[";
            for (int i = 0; i < arr->size(); ++i)
            {
                if (i > 0)
                    out += ",";
                newline (depth + 1);
                encode (arr->getReference (i), false, out, sorted, indent, depth + 1);
            }
            if (! arr->isEmpty())
                newline (depth);
            out += "]";
            return;
        }
        if (v.isBool())
        {
            out += (bool) v ? "true" : "false";
            return;
        }
        if (v.isInt() || v.isInt64())
        {
            out += std::to_string ((juce::int64) v);
            return;
        }
        if (v.isDouble())
        {
            const double d = v;
            if (! std::isfinite (d))
                throw std::runtime_error ("canonicalJson: non-finite number");
            out += jsNumber (d);
            return;
        }
        if (v.isString())
        {
            out += jsQuote (v.toString());
            return;
        }
        // juce::var null is represented by a void var in the JSON parser; objects/arrays handled above.
        out += "null";
    }

    juce::String hexOf (const juce::MemoryBlock& digest)
    {
        return juce::String::toHexString (digest.getData(), (int) digest.getSize(), 0).toLowerCase();
    }
} // namespace

std::string canonicalJson (const juce::var& value, bool omitRootRevision)
{
    std::string out;
    encode (value, omitRootRevision, out, true, 0, 0);
    return out;
}

juce::String sha256Hex (const void* data, size_t size)
{
    juce::SHA256 sha (data, size);
    return hexOf (sha.getRawData());
}

juce::String sha256Hex (const juce::File& file)
{
    juce::FileInputStream in (file);
    if (! in.openedOk())
        return {};
    juce::SHA256 sha (in);
    return hexOf (sha.getRawData());
}

juce::String revisionOf (const juce::var& value)
{
    const auto json = canonicalJson (value, true);
    return sha256Hex (json.data(), json.size()).substring (0, 16);
}

juce::String stableJson (const juce::var& value)
{
    std::string out;
    encode (value, false, out, true, 2, 0);
    out += "\n";
    return juce::String::fromUTF8 (out.c_str(), (int) out.size());
}

std::optional<juce::var> parseJson (const juce::String& text, juce::String& error)
{
    juce::var result;
    const auto r = juce::JSON::parse (text, result);
    if (r.failed())
    {
        error = r.getErrorMessage();
        return std::nullopt;
    }
    return result;
}

bool writeFileAtomic (const juce::File& file, const juce::MemoryBlock& data)
{
    if (! file.getParentDirectory().createDirectory())
        return false;
    juce::TemporaryFile tmp (file, juce::TemporaryFile::useHiddenFile);
    if (! tmp.getFile().replaceWithData (data.getData(), data.getSize()))
        return false;
    return tmp.overwriteTargetFileWithTemporary();
}

bool writeFileAtomic (const juce::File& file, const juce::String& text)
{
    const auto utf8 = text.toUTF8();
    juce::MemoryBlock block (utf8.getAddress(), utf8.sizeInBytes() - 1);
    return writeFileAtomic (file, block);
}

bool FieldReader::has (const char* key) const
{
    auto* o = obj.getDynamicObject();
    return o != nullptr && o->hasProperty (key) && ! o->getProperty (key).isVoid();
}

juce::String FieldReader::string (const char* key, bool required) const
{
    const auto& v = obj[key];
    if (v.isString())
        return v.toString();
    if (required)
        errors.add (where + ": " + key + " must be a string");
    return {};
}

double FieldReader::number (const char* key, double fallback, bool required) const
{
    const auto& v = obj[key];
    if (v.isDouble() || v.isInt() || v.isInt64())
        return (double) v;
    if (required)
        errors.add (where + ": " + key + " must be a number");
    return fallback;
}

int FieldReader::integer (const char* key, int fallback, bool required) const
{
    const auto& v = obj[key];
    if (v.isInt() || v.isInt64())
        return (int) v;
    if (v.isDouble())
    {
        const double d = v;
        if (std::floor (d) == d && std::abs (d) < 2.0e9)
            return (int) d;
    }
    if (required)
        errors.add (where + ": " + key + " must be an integer");
    return fallback;
}

bool FieldReader::boolean (const char* key, bool fallback, bool required) const
{
    const auto& v = obj[key];
    if (v.isBool())
        return (bool) v;
    if (required)
        errors.add (where + ": " + key + " must be a boolean");
    return fallback;
}

const juce::var& FieldReader::array (const char* key, bool required) const
{
    const auto& v = obj[key];
    if (! v.isArray() && required)
        errors.add (where + ": " + key + " must be an array");
    return v;
}

const juce::var& FieldReader::object (const char* key, bool required) const
{
    const auto& v = obj[key];
    if (v.getDynamicObject() == nullptr && required)
        errors.add (where + ": " + key + " must be an object");
    return v;
}

juce::var makeObject()
{
    return juce::var (new juce::DynamicObject());
}

void setProp (juce::var& obj, const juce::String& key, const juce::var& value)
{
    if (auto* o = obj.getDynamicObject())
        o->setProperty (key, value);
}
} // namespace drums
