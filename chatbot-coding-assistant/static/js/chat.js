/* ================================================= */
/* static/js/chat.js (completo y final)      */
/* ================================================= */

document.addEventListener('DOMContentLoaded', () => {
    const chatWindow = document.getElementById('chat-window');
    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');

    /**
     * Hace scroll hasta el final de la ventana del chat.
     */
    const scrollToBottom = () => {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };
    
    /**
     * Crea la estructura de un mensaje del bot con su icono.
     * @param {HTMLElement} messageElement - El div principal del mensaje del bot.
     * @returns {HTMLElement} El elemento <code> donde se escribirá el texto.
     */
    const createBotMessageStructure = (messageElement) => {
        const icon = document.createElement('span');
        icon.classList.add('bot-icon');
        icon.textContent = '🤖';
        messageElement.appendChild(icon);

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-content');
        
        const codeBlock = document.createElement('pre');
        const codeElement = document.createElement('code');
        codeBlock.appendChild(codeElement);
        contentDiv.appendChild(codeBlock);
        messageElement.appendChild(contentDiv);

        return codeElement; // Devolvemos el elemento 'code' para llenarlo
    };

    /**
     * Procesa la respuesta en streaming del servidor.
     * @param {Response} response - El objeto de respuesta del fetch.
     * @param {HTMLElement} botCodeElement - El elemento <code> del mensaje del bot.
     */
    const handleStreamedResponse = async (response, botCodeElement) => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            
            // Procesa los Server-Sent Events (SSE) que llegan.
            const parts = buffer.split('\n\n');
            buffer = parts.pop(); // Lo que quede es parte del siguiente mensaje

            for (const part of parts) {
                if (part.startsWith('data:')) {
                    try {
                        const data = JSON.parse(part.substring(5));
                        if (data.text) {
                            botCodeElement.innerHTML += data.text; // innerHTML para renderizar markdown simple como negritas
                            scrollToBottom();
                        }
                    } catch (e) {
                        console.error('Error al parsear JSON del stream:', e);
                    }
                }
            }
        }
    };

    /**
     * Maneja el envío del formulario de chat.
     */
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (!message) return;

        // 1. Añade el mensaje del usuario a la interfaz.
        const userMessageElement = document.createElement('div');
        userMessageElement.classList.add('message', 'user-message');
        // El mensaje del usuario no necesita el icono, solo el contenedor de contenido.
        const userContent = document.createElement('div');
        userContent.classList.add('message-content');
        const p = document.createElement('p');
        p.textContent = message;
        userContent.appendChild(p);
        userMessageElement.appendChild(userContent);
        chatWindow.appendChild(userMessageElement);
        
        // 2. Limpia el input y deshabilita el botón de envío.
        messageInput.value = '';
        messageInput.style.height = '50px'; // Resetea la altura del textarea
        sendButton.disabled = true;
        scrollToBottom();

        // 3. Crea el elemento para la respuesta del bot y lo añade a la interfaz.
        const botMessageElement = document.createElement('div');
        botMessageElement.classList.add('message', 'bot-message');
        const botCodeElement = createBotMessageStructure(botMessageElement);
        chatWindow.appendChild(botMessageElement);
        scrollToBottom();

        // 4. Realiza la llamada al servidor.
        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('text/event-stream')) {
                // Procesa la respuesta en streaming de Gemini
                await handleStreamedResponse(response, botCodeElement);
            } else {
                // Procesa la respuesta completa de Databricks o un error
                const data = await response.json();
                botCodeElement.innerHTML = data.reply || `<strong>Error:</strong> ${data.error || 'Respuesta desconocida del servidor.'}`;
            }

        } catch (error) {
            console.error('Error al enviar mensaje:', error);
            botCodeElement.innerHTML = '<strong>Error:</strong> No se pudo conectar con el servidor. Por favor, intenta de nuevo.';
        } finally {
            // 5. Rehabilita el botón de envío.
            sendButton.disabled = false;
        }
    });
    
    /**
     * Ajusta la altura del textarea dinámicamente.
     */
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = (messageInput.scrollHeight) + 'px';
    });

    /**
     * Actualiza los indicadores visuales del estado de las APIs.
     * @param {object} status - El objeto de estado de la API.
     */
    const updateApiStatus = (status) => {
        const geminiStatus = document.getElementById('gemini-status');
        const databricksStatus = document.getElementById('databricks-status');

        geminiStatus.className = 'fas fa-circle status-light';
        databricksStatus.className = 'fas fa-circle status-light';

        geminiStatus.classList.add(status.gemini === 'available' ? 'available' : 'limited');
        geminiStatus.title = status.gemini === 'available' ? 'Gemini: Disponible' : 'Gemini: Límite alcanzado o no disponible';

        databricksStatus.classList.add(status.databricks === 'available' ? 'available' : 'unavailable');
        databricksStatus.title = status.databricks === 'available' ? 'Databricks: Disponible' : 'Databricks: No disponible';
    };

    /**
     * Llama al endpoint de estado y actualiza la interfaz.
     */
    const checkApiStatus = async () => {
        try {
            const response = await fetch('/api/status');
            if (!response.ok) throw new Error('Respuesta no exitosa del servidor de estado');
            const status = await response.json();
            updateApiStatus(status);
        } catch (error) {
            console.error('No se pudo obtener el estado de las APIs:', error);
            updateApiStatus({ gemini: 'unavailable', databricks: 'unavailable' });
        }
    };

    // --- Ejecución Inicial ---
    // Verifica el estado al cargar la página y luego periódicamente.
    checkApiStatus();
    setInterval(checkApiStatus, 30000); // Chequea cada 30 segundos.
});
