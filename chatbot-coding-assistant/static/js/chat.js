/* ================================================= */
/* static/js/chat.js (Con efecto máquina de escribir) */
/* ================================================= */

document.addEventListener('DOMContentLoaded', () => {
    // --- 1. CONFIGURACIÓN ---
    // Cambia este valor para ajustar la velocidad. Menor = más rápido. (Ej: 50 es lento, 10 es muy rápido)
    const TYPEWRITER_SPEED = 1;

    // --- Referencias a elementos del DOM ---
    const chatWindow = document.getElementById('chat-window');
    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');

    // --- 2. NUEVA FUNCIÓN DE MÁQUINA DE ESCRIBIR ---
    /**
     * Escribe texto en un elemento carácter por carácter.
     * @param {string} text - El texto a escribir.
     * @param {HTMLElement} element - El elemento donde se escribirá el texto.
     * @returns {Promise<void>} Una promesa que se resuelve cuando el texto ha terminado de escribirse.
     */
    const typewriterEffect = (text, element) => {
        return new Promise(resolve => {
            let i = 0;
            element.innerHTML = ""; // Limpia el contenido previo

            function type() {
                if (i < text.length) {
                    element.innerHTML += text.charAt(i);
                    i++;
                    scrollToBottom(); // Asegura que la ventana se desplace mientras escribe
                    setTimeout(type, TYPEWRITER_SPEED);
                } else {
                    resolve(); // Resuelve la promesa al finalizar
                }
            }
            type();
        });
    };

    // --- Funciones de la Interfaz ---
    const scrollToBottom = () => {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    };

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

        return codeElement;
    };
    
    // --- 3. LÓGICA DE MANEJO DE RESPUESTAS (ACTUALIZADA) ---
    /**
     * Procesa la respuesta en streaming, acumula el texto y luego lo escribe.
     */
    const handleStreamedResponse = async (response, botCodeElement) => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = ''; // Acumula el texto completo aquí

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop();

            for (const part of parts) {
                if (part.startsWith('data:')) {
                    try {
                        const data = JSON.parse(part.substring(5));
                        if (data.text) {
                            fullText += data.text;
                        }
                    } catch (e) {
                        console.error('Error al parsear JSON del stream:', e);
                    }
                }
            }
        }
        // Cuando el stream termina, llama al efecto de máquina de escribir
        await typewriterEffect(fullText, botCodeElement);
    };

    /**
     * Maneja el envío del formulario de chat.
     */
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (!message) return;

        const userMessageElement = document.createElement('div');
        userMessageElement.classList.add('message', 'user-message');
        const userContent = document.createElement('div');
        userContent.classList.add('message-content');
        const p = document.createElement('p');
        p.textContent = message;
        userContent.appendChild(p);
        userMessageElement.appendChild(userContent);
        chatWindow.appendChild(userMessageElement);
        
        messageInput.value = '';
        messageInput.style.height = '50px';
        sendButton.disabled = true;
        scrollToBottom();

        const botMessageElement = document.createElement('div');
        botMessageElement.classList.add('message', 'bot-message');
        const botCodeElement = createBotMessageStructure(botMessageElement);
        chatWindow.appendChild(botMessageElement);
        scrollToBottom();

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message })
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('text/event-stream')) {
                // Procesa la respuesta en streaming (Gemini/LLM)
                await handleStreamedResponse(response, botCodeElement);
            } else {
                // Procesa la respuesta completa (Databricks o error)
                const data = await response.json();
                const reply = data.reply || `<strong>Error:</strong> ${data.error || 'Respuesta desconocida.'}`;
                await typewriterEffect(reply, botCodeElement);
            }

        } catch (error) {
            console.error('Error al enviar mensaje:', error);
            await typewriterEffect('<strong>Error:</strong> No se pudo conectar con el servidor.', botCodeElement);
        } finally {
            sendButton.disabled = false;
        }
    });
    
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = (messageInput.scrollHeight) + 'px';
    });
    
    // --- Funciones de Estado de API (sin cambios) ---
    const updateApiStatus = (status) => {
        const geminiStatus = document.getElementById('gemini-status');
        const databricksStatus = document.getElementById('databricks-status');

        geminiStatus.className = 'fas fa-circle status-light';
        databricksStatus.className = 'fas fa-circle status-light';

        geminiStatus.classList.add(status.gemini === 'available' ? 'available' : 'limited');
        geminiStatus.title = status.gemini === 'available' ? 'LLM: Disponible' : 'LLM: Límite alcanzado o no disponible';

        databricksStatus.classList.add(status.databricks === 'available' ? 'available' : 'unavailable');
        databricksStatus.title = status.databricks === 'available' ? 'Databricks: Disponible' : 'Databricks: No disponible';
    };

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

    checkApiStatus();
    setInterval(checkApiStatus, 30000);
});
