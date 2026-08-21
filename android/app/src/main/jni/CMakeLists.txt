cmake_minimum_required(VERSION 3.13)

# Must be set before project() so autolinked codegen libraries hash
# Windows object paths instead of embedding 260+ character .o names.
set(CMAKE_OBJECT_PATH_MAX 248 CACHE STRING "Windows MAX_PATH ninja workaround" FORCE)

project(appmodules)

include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)
