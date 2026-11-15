// greet: a header the second snippet includes. It is a hidden file of that
// playground alone: its server reads it, Run compiles with it, and go to
// definition (F12) shows it, read-only.
#pragma once

#include <string>

/// A greeting for `name`, with an exclamation mark.
inline std::string greet(const std::string& name) { return "Hello, " + name + "!"; }
