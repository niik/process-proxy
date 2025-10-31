{
  "targets": [
    {
      "target_name": "process-proxy",
      "type": "executable",
      "sources": [
        "native/main.c"
      ],
      'xcode_settings': {
        'OTHER_CFLAGS': [
          '-Wall',
          '-Werror',
          '-Werror=format-security',
          '-fPIC',
          '-D_FORTIFY_SOURCE=1',
          '-fstack-protector-strong'
        ]
      },
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
          "libraries": [
            "-lws2_32"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1
            }
          }
        }]
      ]
    }
  ]
}
