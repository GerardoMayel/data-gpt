import os
import json
from flask import Flask, render_template, request, jsonify, session, Response, stream_with_context
from dotenv import load_dotenv
from services.model_manager import ModelManager

# Cargar variables de entorno del archivo .env al inicio de todo
load_dotenv()

# --- 1. Creación de la Aplicación Flask ---
# Esta es la línea crucial que define la variable 'app' para todo el script.
app = Flask(__name__)
# Configura la clave secreta para la gestión de sesiones. Es vital para la seguridad.
app.secret_key = os.getenv("FLASK_SECRET_KEY")

# --- 2. Inicialización de Servicios ---
# Creamos una única instancia de nuestro gestor de modelos para que la use toda la app.
model_manager = ModelManager()

# --- 3. Definición de Rutas (Endpoints) ---

@app.route('/')
def index():
    """
    Renderiza la página principal y limpia la sesión para un nuevo inicio.
    """
    session.clear()
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    """
    Maneja la lógica principal del chat. Recibe mensajes del usuario,
    los pasa al ModelManager y devuelve la respuesta del modelo,
    manejando tanto streams como respuestas completas.
    """
    user_message = request.json.get('message')
    if not user_message:
        return jsonify({"error": "No se recibió ningún mensaje."}), 400

    # Inicializa el historial de chat en la sesión si es la primera vez.
    if 'chat_history' not in session:
        session['chat_history'] = []
    
    # Añade el mensaje actual del usuario al historial guardado en la sesión.
    session['chat_history'].append({"role": "user", "content": user_message})
    
    try:
        # Pide una respuesta al gestor de modelos.
        response_generator = model_manager.generate_chat_response(session['chat_history'])
        
        # El generador puede ser un stream (Gemini) o una lista [texto] (Databricks).
        if hasattr(response_generator, '__iter__') and not isinstance(response_generator, list):
            # Es un stream de Gemini. Devolvemos una respuesta de tipo 'text/event-stream'.
            def stream_response():
                full_bot_response = ""
                for chunk in response_generator:
                    # Nos aseguramos que el chunk tenga texto antes de procesarlo.
                    if hasattr(chunk, 'text') and chunk.text:
                        full_bot_response += chunk.text
                        # Enviamos cada trozo al frontend en formato Server-Sent Event (SSE).
                        yield f"data: {json.dumps({'text': chunk.text})}\n\n"
                
                # Una vez terminado el stream, guardamos la respuesta completa del bot.
                session['chat_history'].append({"role": "assistant", "content": full_bot_response})
                session.modified = True # Marcamos la sesión como modificada.

            return Response(stream_with_context(stream_response()), mimetype='text/event-stream')
        
        else: 
            # Es una respuesta completa de Databricks o un mensaje de error.
            bot_reply = response_generator[0] if response_generator else "No se obtuvo respuesta."
            session['chat_history'].append({"role": "assistant", "content": bot_reply})
            session.modified = True
            # Devolvemos la respuesta en un solo JSON.
            return jsonify({"reply": bot_reply})

    except Exception as e:
        print(f"Error crítico en la ruta /chat: {e}")
        return jsonify({"error": "Ocurrió un error inesperado en el servidor."}), 500

@app.route('/api/status', methods=['GET'])
def api_status():
    """
    Endpoint para que el frontend pueda consultar periódicamente el estado
    de disponibilidad de las APIs (Gemini y Databricks).
    """
    status = model_manager.check_api_status()
    return jsonify(status)

# --- 4. Bloque de Ejecución Principal ---
# Este bloque SÓLO se ejecuta cuando corres el script con 'python app.py'.
# Es el encargado de iniciar el servidor web de desarrollo de Flask.
if __name__ == '__main__':
    # Lee el puerto desde las variables de entorno (útil para despliegues) o usa 5001 por defecto.
    port = int(os.environ.get('PORT', 5001))
    
    # Activa el modo debug si la variable de entorno FLASK_ENV es 'development'.
    # El modo debug reinicia el servidor automáticamente cuando guardas cambios en el código.
    is_debug_mode = os.getenv("FLASK_ENV", "production").lower() == "development"
    
    print(f"Iniciando servidor Flask en http://0.0.0.0:{port}, Debug: {is_debug_mode}")
    
    # Inicia la aplicación. host='0.0.0.0' hace que sea accesible desde otros dispositivos en tu red.
    app.run(host='0.0.0.0', port=port, debug=is_debug_mode)
