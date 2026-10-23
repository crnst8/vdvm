# Changelog

## 1.2.0 - 2026-10-23

- Echo sheet redesigned as the SPEC-O tape unit
- Sheets sized and laid out for each device
- Panel header: function keys, machine search, machine images
- Add RE-201 tape echo with spring reverb

## 1.1.0 - 2026-10-14

- The GROOVE key is now a RHYTHM key (a music note). Its sheet holds swing and grid, and preset rhythms from the original machines: 24 Roland CR-78 bars (Rock, Disco, Bossa Nova, Enka, Fox Trot, Tango, Shuffle, Swing, Boogie) and 14 Boss DR-110 presets, transcribed from Roland's service notes and Boss's owner's manual. A preset replaces the pattern's steps, sets its accents and shuffle, and can be undone. On desktop a RHYTHM key opens the same sheet.
- Installed on an iPhone home screen, the app fills the screen again: no blank band at the bottom and no controls under the status bar. Remove the app from the home screen and add it again to pick up the change.
- The about card links to the source code and the plugin site.
- Narrow desktop windows no longer scroll sideways when a machine has the CIRCUIT key.

## 1.0.0 - 2026-10-09

First public release.

- Web app at re20.one and a VST3 / AU plugin for macOS.
- Plugin installers make every installed file readable. Earlier bundled installers left part of the sample library readable only by root, and those kits failed to load.
- The repository builds and tests without the sample archive, using three generated test kits.
