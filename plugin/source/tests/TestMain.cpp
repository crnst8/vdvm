// Headless core test runner. Exit status 1 when any test fails.
//   plugin/dev test [category]
#include <juce_core/juce_core.h>

int main (int argc, char** argv)
{
    juce::UnitTestRunner runner;
    runner.setAssertOnFailure (false);
    runner.setPassesAreLogged (false);
    if (argc > 1)
        runner.runTestsInCategory (argv[1]);
    else
        runner.runAllTests();
    int failures = 0, passes = 0;
    for (int i = 0; i < runner.getNumResults(); ++i)
    {
        const auto* r = runner.getResult (i);
        failures += r->failures;
        passes += r->passes;
    }
    std::printf ("\n%d checks passed, %d failed, %d test groups\n", passes, failures, runner.getNumResults());
    return failures > 0 ? 1 : 0;
}
