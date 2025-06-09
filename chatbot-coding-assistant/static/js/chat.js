document.addEventListener('DOMContentLoaded', () => {
    const chatWindow = document.getElementById('chat-window');
    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');

    // --- Funciones del Chat ---

    const addMessage = (message, sender) => {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${sender}-message`);
        
        // Usamos <pre> y <code> para respuestas de bot para preservar formato de código
        if (sender === 'bot') {
            const codeBlock = document.createElement('pre');
            const codeElement = document.createElement('code');
            codeElement.innerHTML = message; // innerHTML para renderizar el formato del markdown
            codeBlock.appendChild(codeElement);
            messageElement.appendChild(codeBlock);
        } else {
            const p = document.createElement('p');
            p.textContent = message;
            messageElement.appendChild(p);
        }
        
        chatWindow.appendChild(messageElement);
        scrollToBottom();
        return messageElement;
    };

    const scrollToBottom = () => {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };
    
    // --- Lógica para el efecto de "escritura" ---
    
    const createBotMessageElement = () => {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'bot-message');
        const codeBlock = document.createElement('pre');
        const codeElement = document.createElement('code');
        codeBlock.appendChild(codeElement);
        messageElement.appendChild(codeBlock);
        chatWindow.appendChild(messageElement);
        return codeElement;
    };

    const handleStreamedResponse = async (response, botMessageElement) => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            
            // Procesar Server-Sent Events (SSE)
            const parts = buffer.split('\n\n');
            buffer = parts.pop(); // Lo que quede es parte del siguiente mensaje

            for (const part of parts) {
                if (part.startsWith('data:')) {
                    try {
                        const data = JSON.parse(part.substring(5));
                        if (data.text) {
                            botMessageElement.innerHTML += data.text;
                            scrollToBottom();
                        }
                    } catch (e) {
                        console.error('Error al parsear JSON del stream:', e);
                    }
                }
            }
        }
    };


    // --- Manejo del Formulario y Envío ---

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (!message) return;

        addMessage(message, 'user');
        messageInput.value = '';
        messageInput.style.height = '50px'; // Reset height
        sendButton.disabled = true;

        // Crear el elemento para la respuesta del bot que se llenará gradualmente
        const botMessageElement = createBotMessageElement();

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Detectar si la respuesta es un stream (Gemini) o un JSON (Databricks/Error)
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('text/event-stream')) {
                // Es un stream de Gemini
                await handleStreamedResponse(response, botMessageElement);
            } else {
                // Es una respuesta completa de Databricks o un error
                const data = await response.json();
                if(data.reply) {
                    botMessageElement.innerHTML = data.reply;
                } else {
                    botMessageElement.innerHTML = `<strong>Error:</strong> ${data.error || 'Respuesta desconocida del servidor.'}`;
                }
            }

        } catch (error) {
            console.error('Error al enviar mensaje:', error);
            botMessageElement.innerHTML = '<strong>Error:</strong> No se pudo conectar con el servidor. Por favor, intenta de nuevo.';
        } finally {
            sendButton.disabled = false;
            scrollToBottom();
        }
    });
    
    // Auto-ajustar altura del textarea
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = (messageInput.scrollHeight) + 'px';
    });


    // --- Monitoreo de Estado de APIs ---

    const updateApiStatus = (status) => {
        const geminiStatus = document.getElementById('gemini-status');
        const databricksStatus = document.getElementById('databricks-status');

        // Reset classes
        geminiStatus.className = 'fas fa-circle status-light';
        databricksStatus.className = 'fas fa-circle status-light';

        // Set Gemini status color
        if (status.gemini === 'available') {
            geminiStatus.classList.add('available');
            geminiStatus.title = 'Gemini: Disponible';
        } else {
            geminiStatus.classList.add('limited');
            geminiStatus.title = 'Gemini: Límite alcanzado o no disponible';
        }

        // Set Databricks status color
        if (status.databricks === 'available') {
            databricksStatus.classList.add('available');
            databricksStatus.title = 'Databricks: Disponible';
        } else {
            databricksStatus.classList.add('unavailable');
            databricksStatus.title = 'Databricks: No disponible';
        }
    };

    const checkApiStatus = async () => {
        try {
            const response = await fetch('/api/status');
            const status = await response.json();
            updateApiStatus(status);
        } catch (error) {
            console.error('No se pudo obtener el estado de las APIs:', error);
            // Marcar ambos como no disponibles si falla la llamada de estado
            updateApiStatus({ gemini: 'unavailable', databricks: 'unavailable' });
        }
    };

    // Verificar el estado al cargar y luego cada 30 segundos
    checkApiStatus();
    setInterval(checkApiStatus, 30000);
});