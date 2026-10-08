# V.D.V.M native plugin (VST3, AU, Standalone) and its headless core tests.
# Build with ./plugin/dev build (see plugin/README.md).
cmake_minimum_required(VERSION 3.25)

file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../package.json" DRUMS_PACKAGE_JSON)
string(JSON DRUMS_VERSION GET "${DRUMS_PACKAGE_JSON}" version)

project(DrumsPlugin VERSION ${DRUMS_VERSION} LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Minimum macOS version")
set_property(GLOBAL PROPERTY USE_FOLDERS YES)

option(DRUMS_BUILD_PLUGIN "Build the VST3/AU/Standalone plugin" ON)
option(DRUMS_BUILD_TESTS "Build the headless core test runner" ON)

# JUCE is pinned. Point FETCHCONTENT_SOURCE_DIR_JUCE at a local checkout of the
# same tag to build without a download (plugin/dev does this when it can).
include(FetchContent)
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 8.0.9
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(JUCE)

set(DRUMS_CORE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/source/core")
set(DRUMS_CORE_SOURCES
  ${DRUMS_CORE_DIR}/Json.cpp
  ${DRUMS_CORE_DIR}/Contract.cpp
  ${DRUMS_CORE_DIR}/Loudness.cpp
  ${DRUMS_CORE_DIR}/Pattern.cpp
  ${DRUMS_CORE_DIR}/Timing.cpp
  ${DRUMS_CORE_DIR}/MidiMap.cpp
  ${DRUMS_CORE_DIR}/Resampler.cpp
  ${DRUMS_CORE_DIR}/SampleStore.cpp
  ${DRUMS_CORE_DIR}/DrumEngine.cpp
  ${DRUMS_CORE_DIR}/Playback.cpp
  ${DRUMS_CORE_DIR}/Render.cpp
  ${DRUMS_CORE_DIR}/Library.cpp
  ${DRUMS_CORE_DIR}/Importer.cpp
  ${DRUMS_CORE_DIR}/Stores.cpp
  ${DRUMS_CORE_DIR}/Session.cpp)

# Data shared with the browser app (circuit timing, GM notes, constants),
# generated from src/ by plugin/scripts/gen-shared.ts and checked by npm test.
juce_add_binary_data(drums_shared_data
  NAMESPACE DrumsShared
  HEADER_NAME DrumsSharedData.h
  SOURCES ${DRUMS_CORE_DIR}/generated/shared.json)

set(DRUMS_JUCE_MODULES
  juce::juce_core
  juce::juce_cryptography
  juce::juce_audio_basics
  juce::juce_audio_formats
  juce::juce_events
  juce::juce_data_structures)

set(DRUMS_COMMON_DEFINITIONS
  JUCE_USE_CURL=0
  JUCE_STRICT_REFCOUNTEDPOINTER=1
  DRUMS_VERSION="${DRUMS_VERSION}")

if(DRUMS_BUILD_TESTS)
  juce_add_console_app(DrumsCoreTests PRODUCT_NAME "drums-core-tests")
  target_sources(DrumsCoreTests PRIVATE
    ${DRUMS_CORE_SOURCES}
    source/tests/TestMain.cpp
    source/tests/TestUtil.cpp
    source/tests/ContractTests.cpp
    source/tests/DspTests.cpp
    source/tests/SequencerTests.cpp
    source/tests/LibraryTests.cpp
    source/tests/StateTests.cpp)
  target_include_directories(DrumsCoreTests PRIVATE source)
  target_compile_definitions(DrumsCoreTests PRIVATE ${DRUMS_COMMON_DEFINITIONS}
    DRUMS_REPO_ROOT="${CMAKE_CURRENT_SOURCE_DIR}/.."
    JUCE_WEB_BROWSER=0
    JUCE_MODAL_LOOPS_PERMITTED=0)
  target_link_libraries(DrumsCoreTests PRIVATE drums_shared_data ${DRUMS_JUCE_MODULES}
    juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
endif()

if(DRUMS_BUILD_PLUGIN)
  # The WebView frontend: npm run plugin:ui writes plugin/build-ui/ui.zip.
  set(DRUMS_UI_ZIP "${CMAKE_CURRENT_SOURCE_DIR}/build-ui/ui.zip" CACHE FILEPATH "Zipped plugin frontend")
  if(NOT EXISTS "${DRUMS_UI_ZIP}")
    message(FATAL_ERROR "Missing ${DRUMS_UI_ZIP}. Run: npm run plugin:ui")
  endif()
  juce_add_binary_data(drums_ui_data
    NAMESPACE DrumsUi
    HEADER_NAME DrumsUiData.h
    SOURCES ${DRUMS_UI_ZIP})

  juce_add_plugin(Drums
    COMPANY_NAME "V.D.V.M"
    COMPANY_WEBSITE "https://re20.one"
    BUNDLE_ID "one.re20.vdvm"
    PLUGIN_MANUFACTURER_CODE Vdvm
    PLUGIN_CODE Vdm1
    FORMATS VST3 AU Standalone
    PRODUCT_NAME "V.D.V.M"
    PLUGIN_NAME "V.D.V.M"
    DESCRIPTION "16-step drum machine with sample libraries"
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    NEEDS_WEBVIEW2 TRUE
    VST3_CATEGORIES Instrument Drum
    AU_MAIN_TYPE kAudioUnitType_MusicDevice
    COPY_PLUGIN_AFTER_BUILD FALSE)

  target_sources(Drums PRIVATE
    ${DRUMS_CORE_SOURCES}
    source/plugin/PluginProcessor.cpp
    source/plugin/PluginEditor.cpp
    source/plugin/Bridge.cpp
    source/plugin/WebZoomOther.cpp
    $<$<PLATFORM_ID:Darwin>:${CMAKE_CURRENT_SOURCE_DIR}/source/plugin/WebZoom.mm>)
  target_include_directories(Drums PRIVATE source)
  target_compile_definitions(Drums PUBLIC ${DRUMS_COMMON_DEFINITIONS}
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_WEB_BROWSER=1
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
  target_link_libraries(Drums PRIVATE drums_shared_data drums_ui_data ${DRUMS_JUCE_MODULES}
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_gui_basics
    juce::juce_gui_extra
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)
endif()

if(DRUMS_BUILD_PLUGIN AND DRUMS_BUILD_TESTS)
  # Loads the built VST3 like a DAW does; see source/hosttest/HostTest.cpp.
  juce_add_console_app(DrumsHostTest PRODUCT_NAME "drums-host-test")
  target_sources(DrumsHostTest PRIVATE source/hosttest/HostTest.cpp)
  target_compile_definitions(DrumsHostTest PRIVATE
    JUCE_PLUGINHOST_VST3=1 JUCE_PLUGINHOST_AU=0 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_MODAL_LOOPS_PERMITTED=1)
  target_link_libraries(DrumsHostTest PRIVATE juce::juce_audio_processors juce::juce_events
    juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
  add_dependencies(DrumsHostTest Drums_VST3)
endif()
