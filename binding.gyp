{
  "targets": [
    {
      "target_name": "process-proxy",
      "type": "executable",
      "sources": [
        "native/main.c"
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
