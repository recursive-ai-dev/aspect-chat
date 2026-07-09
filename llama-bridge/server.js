const http = require('http');

const LLAMA_API_URL = process.env.LLAMA_API_URL || 'http://127.0.0.1:8080/v1';
const PORT = process.env.PORT || 1234;

const server = http.createServer((req, res) => {
    // Enable CORS for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/v1/models' && req.method === 'GET') {
        // Mock models endpoint if the underlying server doesn't support it
        const modelsResponse = {
            object: 'list',
            data: [
                {
                    id: 'local-model',
                    object: 'model',
                    created: Date.now(),
                    owned_by: 'llama.cpp'
                }
            ]
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(modelsResponse));
        return;
    }

    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            fetch(`${LLAMA_API_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': req.headers.authorization || ''
                },
                body: body
            })
            .then(async llamaRes => {
                res.writeHead(llamaRes.status, {
                    'Content-Type': llamaRes.headers.get('content-type') || 'application/json',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });

                if (llamaRes.body) {
                    // For streaming response
                    const reader = llamaRes.body.getReader();
                    const pump = async () => {
                        const { done, value } = await reader.read();
                        if (done) {
                            res.end();
                            return;
                        }
                        res.write(value);
                        pump();
                    };
                    pump();
                } else {
                    res.end();
                }
            })
            .catch(err => {
                console.error("Error proxying to llama server:", err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: "Failed to connect to local llama server" } }));
            });
        });
        return;
    }

    res.writeHead(404);
    res.end();
});

server.listen(PORT, () => {
    console.log(`Llama.cpp Bridge Server running on http://localhost:${PORT}`);
    console.log(`Proxying requests to ${LLAMA_API_URL}`);
});
