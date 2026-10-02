if(NOT TARGET hermes-engine::hermesvm)
add_library(hermes-engine::hermesvm SHARED IMPORTED)
set_target_properties(hermes-engine::hermesvm PROPERTIES
    IMPORTED_LOCATION "/home/rajasekar/.gradle/caches/9.4.1/transforms/cb74f671c90fd9062c26e633f1d2a6cd/transformed/hermes-android-250829098.0.17-debug/prefab/modules/hermesvm/libs/android.arm64-v8a/libhermesvm.so"
    INTERFACE_INCLUDE_DIRECTORIES "/home/rajasekar/.gradle/caches/9.4.1/transforms/cb74f671c90fd9062c26e633f1d2a6cd/transformed/hermes-android-250829098.0.17-debug/prefab/modules/hermesvm/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

