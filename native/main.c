#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#ifdef _WIN32
    #define WIN32_LEAN_AND_MEAN
    #include <windows.h>
    #include <winsock2.h>
    #include <ws2tcpip.h>
    #include <io.h>
    #include <fcntl.h>
    #pragma comment(lib, "ws2_32.lib")
    typedef SOCKET socket_t;
    #define INVALID_SOCKET_VALUE INVALID_SOCKET
    #define close_socket closesocket
    #define STDIN_FILENO 0
    #define STDOUT_FILENO 1
    #define STDERR_FILENO 2
#else
    #include <sys/socket.h>
    #include <arpa/inet.h>
    #include <unistd.h>
    #include <fcntl.h>
    #include <errno.h>
    typedef int socket_t;
    #define INVALID_SOCKET_VALUE -1
    #define close_socket close
#endif

// Command identifiers
#define CMD_GET_ARGS 0x01
#define CMD_READ_STDIN 0x02
#define CMD_WRITE_STDOUT 0x03
#define CMD_WRITE_STDERR 0x04
#define CMD_GET_CWD 0x05
#define CMD_GET_ENV 0x06
#define CMD_EXIT 0x07
#define CMD_CLOSE_STDIN 0x09
#define CMD_CLOSE_STDOUT 0x0A
#define CMD_CLOSE_STDERR 0x0B

// Global variables for argc and argv
static int g_argc = 0;
static char** g_argv = NULL;
static socket_t g_socket = INVALID_SOCKET_VALUE;

// Helper function to write exactly n bytes to socket
static int write_full(socket_t sock, const void* buf, size_t len) {
    size_t written = 0;
    const uint8_t* ptr = (const uint8_t*)buf;
    
    while (written < len) {
        int result = send(sock, (const char*)(ptr + written), (int)(len - written), 0);
        if (result <= 0) {
            return -1;
        }
        written += result;
    }
    return 0;
}

// Helper function to read exactly n bytes from socket
static int read_full(socket_t sock, void* buf, size_t len) {
    size_t total_read = 0;
    uint8_t* ptr = (uint8_t*)buf;
    
    while (total_read < len) {
        int result = recv(sock, (char*)(ptr + total_read), (int)(len - total_read), 0);
        if (result <= 0) {
            return -1;
        }
        total_read += result;
    }
    return 0;
}

// Command handlers
static int handle_get_args(socket_t sock) {
    uint32_t count = (uint32_t)g_argc;
    
    // Send count
    if (write_full(sock, &count, sizeof(count)) < 0) {
        return -1;
    }
    
    // Send each argument
    for (int i = 0; i < g_argc; i++) {
        uint32_t len = (uint32_t)strlen(g_argv[i]);
        if (write_full(sock, &len, sizeof(len)) < 0) {
            return -1;
        }
        if (write_full(sock, g_argv[i], len) < 0) {
            return -1;
        }
    }
    
    return 0;
}

static int handle_read_stdin(socket_t sock) {
    int32_t max_bytes;
    
    // Read max_bytes parameter
    if (read_full(sock, &max_bytes, sizeof(max_bytes)) < 0) {
        return -1;
    }
    
    if (max_bytes <= 0) {
        int32_t bytes_read = 0;
        return write_full(sock, &bytes_read, sizeof(bytes_read));
    }
    
    // Allocate buffer
    uint8_t* buffer = (uint8_t*)malloc(max_bytes);
    if (!buffer) {
        int32_t bytes_read = -1;
        return write_full(sock, &bytes_read, sizeof(bytes_read));
    }
    
    // Set stdin to non-blocking mode
#ifdef _WIN32
    HANDLE hStdin = GetStdHandle(STD_INPUT_HANDLE);
    DWORD bytes_available = 0;
    if (!PeekNamedPipe(hStdin, NULL, 0, NULL, &bytes_available, NULL)) {
        // stdin might be closed
        free(buffer);
        int32_t bytes_read = -1;
        return write_full(sock, &bytes_read, sizeof(bytes_read));
    }
    
    int32_t bytes_read = 0;
    if (bytes_available > 0) {
        DWORD to_read = (bytes_available < (DWORD)max_bytes) ? bytes_available : (DWORD)max_bytes;
        DWORD actual_read = 0;
        if (ReadFile(hStdin, buffer, to_read, &actual_read, NULL)) {
            bytes_read = (int32_t)actual_read;
        } else {
            bytes_read = -1;
        }
    }
#else
    // Set stdin to non-blocking
    int flags = fcntl(STDIN_FILENO, F_GETFL, 0);
    fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK);
    
    ssize_t result = read(STDIN_FILENO, buffer, max_bytes);
    int32_t bytes_read;
    
    if (result < 0) {
        if (errno == EAGAIN || errno == EWOULDBLOCK) {
            bytes_read = 0;
        } else {
            bytes_read = -1;
        }
    } else if (result == 0) {
        bytes_read = -1; // EOF
    } else {
        bytes_read = (int32_t)result;
    }
    
    // Restore blocking mode
    fcntl(STDIN_FILENO, F_SETFL, flags);
#endif
    
    // Send bytes read
    if (write_full(sock, &bytes_read, sizeof(bytes_read)) < 0) {
        free(buffer);
        return -1;
    }
    
    // Send data if any was read
    if (bytes_read > 0) {
        if (write_full(sock, buffer, bytes_read) < 0) {
            free(buffer);
            return -1;
        }
    }
    
    free(buffer);
    return 0;
}

static int handle_write_stdout(socket_t sock) {
    uint32_t len;
    
    // Read length
    if (read_full(sock, &len, sizeof(len)) < 0) {
        return -1;
    }
    
    if (len == 0) {
        return 0;
    }
    
    // Read data
    uint8_t* buffer = (uint8_t*)malloc(len);
    if (!buffer) {
        return -1;
    }
    
    if (read_full(sock, buffer, len) < 0) {
        free(buffer);
        return -1;
    }
    
    // Write to stdout
    fwrite(buffer, 1, len, stdout);
    fflush(stdout);
    
    free(buffer);
    return 0;
}

static int handle_write_stderr(socket_t sock) {
    uint32_t len;
    
    // Read length
    if (read_full(sock, &len, sizeof(len)) < 0) {
        return -1;
    }
    
    if (len == 0) {
        return 0;
    }
    
    // Read data
    uint8_t* buffer = (uint8_t*)malloc(len);
    if (!buffer) {
        return -1;
    }
    
    if (read_full(sock, buffer, len) < 0) {
        free(buffer);
        return -1;
    }
    
    // Write to stderr
    fwrite(buffer, 1, len, stderr);
    fflush(stderr);
    
    free(buffer);
    return 0;
}

static int handle_get_cwd(socket_t sock) {
#ifdef _WIN32
    WCHAR wide_path[MAX_PATH + 1];
    DWORD len = GetCurrentDirectoryW(MAX_PATH, wide_path);
    
    if (len == 0 || len > MAX_PATH) {
        // Try with longer path or get short path
        WCHAR* long_path = (WCHAR*)malloc(32768 * sizeof(WCHAR));
        if (!long_path) {
            uint32_t zero = 0;
            return write_full(sock, &zero, sizeof(zero));
        }
        
        len = GetCurrentDirectoryW(32768, long_path);
        if (len == 0 || len > 32768) {
            free(long_path);
            uint32_t zero = 0;
            return write_full(sock, &zero, sizeof(zero));
        }
        
        // Get short path if too long
        if (len > MAX_PATH) {
            WCHAR short_path[MAX_PATH + 1];
            DWORD short_len = GetShortPathNameW(long_path, short_path, MAX_PATH);
            if (short_len > 0 && short_len <= MAX_PATH) {
                wcscpy_s(wide_path, MAX_PATH, short_path);
                len = short_len;
            }
        } else {
            wcscpy_s(wide_path, MAX_PATH, long_path);
        }
        
        free(long_path);
    }
    
    // Convert to UTF-8
    int utf8_len = WideCharToMultiByte(CP_UTF8, 0, wide_path, -1, NULL, 0, NULL, NULL);
    if (utf8_len <= 0) {
        uint32_t zero = 0;
        return write_full(sock, &zero, sizeof(zero));
    }
    
    char* utf8_path = (char*)malloc(utf8_len);
    if (!utf8_path) {
        uint32_t zero = 0;
        return write_full(sock, &zero, sizeof(zero));
    }
    
    WideCharToMultiByte(CP_UTF8, 0, wide_path, -1, utf8_path, utf8_len, NULL, NULL);
    
    uint32_t path_len = (uint32_t)(utf8_len - 1); // -1 to exclude null terminator
    if (write_full(sock, &path_len, sizeof(path_len)) < 0) {
        free(utf8_path);
        return -1;
    }
    
    int result = write_full(sock, utf8_path, path_len);
    free(utf8_path);
    return result;
#else
    char cwd[4096];
    if (getcwd(cwd, sizeof(cwd)) == NULL) {
        uint32_t zero = 0;
        return write_full(sock, &zero, sizeof(zero));
    }
    
    uint32_t len = (uint32_t)strlen(cwd);
    if (write_full(sock, &len, sizeof(len)) < 0) {
        return -1;
    }
    
    return write_full(sock, cwd, len);
#endif
}

static int handle_get_env(socket_t sock) {
#ifdef _WIN32
    LPWCH env_block = GetEnvironmentStringsW();
    if (!env_block) {
        uint32_t zero = 0;
        return write_full(sock, &zero, sizeof(zero));
    }
    
    // Count environment variables
    uint32_t count = 0;
    LPWCH ptr = env_block;
    while (*ptr) {
        count++;
        ptr += wcslen(ptr) + 1;
    }
    
    // Send count
    if (write_full(sock, &count, sizeof(count)) < 0) {
        FreeEnvironmentStringsW(env_block);
        return -1;
    }
    
    // Send each variable
    ptr = env_block;
    while (*ptr) {
        // Convert to UTF-8
        int utf8_len = WideCharToMultiByte(CP_UTF8, 0, ptr, -1, NULL, 0, NULL, NULL);
        if (utf8_len <= 0) {
            FreeEnvironmentStringsW(env_block);
            return -1;
        }
        
        char* utf8_str = (char*)malloc(utf8_len);
        if (!utf8_str) {
            FreeEnvironmentStringsW(env_block);
            return -1;
        }
        
        WideCharToMultiByte(CP_UTF8, 0, ptr, -1, utf8_str, utf8_len, NULL, NULL);
        
        uint32_t str_len = (uint32_t)(utf8_len - 1); // -1 to exclude null terminator
        if (write_full(sock, &str_len, sizeof(str_len)) < 0) {
            free(utf8_str);
            FreeEnvironmentStringsW(env_block);
            return -1;
        }
        
        if (write_full(sock, utf8_str, str_len) < 0) {
            free(utf8_str);
            FreeEnvironmentStringsW(env_block);
            return -1;
        }
        
        free(utf8_str);
        ptr += wcslen(ptr) + 1;
    }
    
    FreeEnvironmentStringsW(env_block);
#else
    extern char** environ;
    
    // Count environment variables
    uint32_t count = 0;
    for (char** env = environ; *env; env++) {
        count++;
    }
    
    // Send count
    if (write_full(sock, &count, sizeof(count)) < 0) {
        return -1;
    }
    
    // Send each variable
    for (char** env = environ; *env; env++) {
        uint32_t len = (uint32_t)strlen(*env);
        if (write_full(sock, &len, sizeof(len)) < 0) {
            return -1;
        }
        if (write_full(sock, *env, len) < 0) {
            return -1;
        }
    }
#endif
    
    return 0;
}

static int handle_exit_cmd(socket_t sock) {
    int32_t exit_code;
    
    // Read exit code
    if (read_full(sock, &exit_code, sizeof(exit_code)) < 0) {
        return -1;
    }
    
    // Close socket and exit
    close_socket(sock);
    exit(exit_code);
    
    return 0; // Never reached
}

static int handle_close_stdin(socket_t sock) {
#ifdef _WIN32
    CloseHandle(GetStdHandle(STD_INPUT_HANDLE));
#else
    close(STDIN_FILENO);
#endif
    return 0;
}

static int handle_close_stdout(socket_t sock) {
    fflush(stdout);
#ifdef _WIN32
    CloseHandle(GetStdHandle(STD_OUTPUT_HANDLE));
#else
    close(STDOUT_FILENO);
#endif
    return 0;
}

static int handle_close_stderr(socket_t sock) {
    fflush(stderr);
#ifdef _WIN32
    CloseHandle(GetStdHandle(STD_ERROR_HANDLE));
#else
    close(STDERR_FILENO);
#endif
    return 0;
}

int main(int argc, char* argv[]) {
    g_argc = argc;
    g_argv = argv;
    
    // Get port from environment variable
    const char* port_str = getenv("PROCESS_PROXY_PORT");
    if (!port_str) {
        fprintf(stderr, "Error: PROCESS_PROXY_PORT environment variable not set\n");
        return 1;
    }
    
    int port = atoi(port_str);
    if (port <= 0 || port > 65535) {
        fprintf(stderr, "Error: Invalid port number in PROCESS_PROXY_PORT: %s\n", port_str);
        return 1;
    }
    
#ifdef _WIN32
    // Initialize Winsock
    WSADATA wsa_data;
    if (WSAStartup(MAKEWORD(2, 2), &wsa_data) != 0) {
        fprintf(stderr, "Error: WSAStartup failed\n");
        return 1;
    }
#endif
    
    // Create socket
    g_socket = socket(AF_INET, SOCK_STREAM, 0);
    if (g_socket == INVALID_SOCKET_VALUE) {
        fprintf(stderr, "Error: Failed to create socket\n");
#ifdef _WIN32
        WSACleanup();
#endif
        return 1;
    }
    
    // Connect to server
    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(port);
    
#ifdef _WIN32
    server_addr.sin_addr.s_addr = inet_addr("127.0.0.1");
#else
    inet_pton(AF_INET, "127.0.0.1", &server_addr.sin_addr);
#endif
    
    if (connect(g_socket, (struct sockaddr*)&server_addr, sizeof(server_addr)) < 0) {
        fprintf(stderr, "Error: Failed to connect to localhost:%d\n", port);
        close_socket(g_socket);
#ifdef _WIN32
        WSACleanup();
#endif
        return 1;
    }
    
    // Main command loop
    while (1) {
        uint8_t cmd;
        int result = recv(g_socket, (char*)&cmd, 1, 0);
        
        if (result <= 0) {
            // Connection closed or error
            break;
        }
        
        int handler_result = 0;
        
        switch (cmd) {
            case CMD_GET_ARGS:
                handler_result = handle_get_args(g_socket);
                break;
            case CMD_READ_STDIN:
                handler_result = handle_read_stdin(g_socket);
                break;
            case CMD_WRITE_STDOUT:
                handler_result = handle_write_stdout(g_socket);
                break;
            case CMD_WRITE_STDERR:
                handler_result = handle_write_stderr(g_socket);
                break;
            case CMD_GET_CWD:
                handler_result = handle_get_cwd(g_socket);
                break;
            case CMD_GET_ENV:
                handler_result = handle_get_env(g_socket);
                break;
            case CMD_EXIT:
                handler_result = handle_exit_cmd(g_socket);
                break;
            case CMD_CLOSE_STDIN:
                handler_result = handle_close_stdin(g_socket);
                break;
            case CMD_CLOSE_STDOUT:
                handler_result = handle_close_stdout(g_socket);
                break;
            case CMD_CLOSE_STDERR:
                handler_result = handle_close_stderr(g_socket);
                break;
            default:
                // Unknown command, close connection
                handler_result = -1;
                break;
        }
        
        if (handler_result < 0) {
            break;
        }
    }
    
    // Cleanup
    close_socket(g_socket);
#ifdef _WIN32
    WSACleanup();
#endif
    
    return 0;
}
