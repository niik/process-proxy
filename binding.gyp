{
  "conditions": [
    # Set platform variable based on OS to match process.platform
    ["OS=='mac'", {
      "variables": {
        "platform": "darwin"
      }
    }],
    ["OS=='win'", {
      "variables": {
        "platform": "win32"
      }
    }],
    ["OS=='linux'", {
      "variables": {
        "platform": "linux"
      }
    }]
  ],
  "target_defaults": {
    "sources": [
      "native/main.c"
    ],
  },
  "targets": [
    {
      "target_name": "process-proxy-<(platform)-<(target_arch)",
      "type": "executable",
      "sources": [
        "native/main.c"
      ],
      'cflags!': [
        '-Wall',
        '-Werror',
        '-fPIC',
        '-pie',
        '-D_FORTIFY_SOURCE=1',
        '-fstack-protector-strong',
        '-Werror=format-security'
      ],
      'ldflags!': [
        '-z relro',
        '-z now'
      ],
      "conditions": [
        ["OS=='win'", {
          "libraries": [ "-lws2_32" ]
        }],
        ["OS=='mac'", {
          'xcode_settings': {
            'OTHER_CFLAGS': [
              '-Wall',
              '-Werror',
              '-Werror=format-security',
              '-fPIC',
              '-D_FORTIFY_SOURCE=1',
              '-fstack-protector-strong',
            ],
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
          },
        }]
      ]
    }
  ]
}
