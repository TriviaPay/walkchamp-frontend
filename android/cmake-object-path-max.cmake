# Windows ninja Stat() fails above 260 characters. Hash object names when
# the full path would exceed this limit. Must stay above the object dir
# length (~160) or CMake ignores the cap.
set(CMAKE_OBJECT_PATH_MAX "248" CACHE STRING "Windows MAX_PATH ninja workaround" FORCE)
