import os
import google.generativeai as genai
import requests
import json
from google.api_core.exceptions import ResourceExhausted

# --- Configuración de APIs desde el archivo .env ---
try:
    genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
except Exception as e:
    print(f"ADVERTENCIA: No se pudo configurar la API de Gemini. Error: {e}")

DATABRICKS_TOKEN = os.getenv("DATABRICKS_TOKEN")
DATABRICKS_ENDPOINT_URL = os.getenv("DATABRICKS_ENDPOINT_URL")

# --- Prompt de Sistema Centralizado ---
# Define las reglas que ambos modelos deben seguir.
SYSTEM_PROMPT = """You are an expert coding assistant. Follow these rules strictly:
1. **Code Formatting:** Always wrap any code block in Markdown triple backticks. Specify the language, for example:
   ```sql
   SELECT * FROM my_table;
   ```
2. **Database Priority:** When asked for database code, use the following priority:
   - 1st: Databricks SQL Warehouse
   - 2nd: Oracle 12c
   - 3rd: Microsoft SQL Server
3. **Databricks Context:** Assume you are in a modern Databricks environment where the SparkSession is created automatically and is available globally as the 'spark' variable. Do not write code to create it.
"""

class ModelManager:
    """
    Gestiona la selección de modelos (Gemini o Databricks) y maneja el estado de disponibilidad.
    """
    def __init__(self):
        self.gemini_available = True
        self.databricks_ping_ok = False
        print("ModelManager inicializado.")
        self.check_api_status() 

    def get_active_model(self):
        """Determina qué modelo usar, priorizando siempre Gemini si está disponible."""
        if self.gemini_available:
            return 'gemini'
        elif self.databricks_ping_ok:
            return 'databricks'
        else:
            return 'unavailable'

    def generate_chat_response(self, chat_history):
        """
        Genera una respuesta usando el modelo activo, inyectando el prompt del sistema.
        """
        model_to_use = self.get_active_model()
        print(f"Intentando generar respuesta con: {model_to_use}")

        if model_to_use == 'gemini':
            try:
                model = genai.GenerativeModel('gemini-1.5-flash')
                # Inyectamos el prompt del sistema en el historial para Gemini
                gemini_history = self._adapt_history_for_gemini(chat_history)
                response_stream = model.generate_content(gemini_history, stream=True)
                return response_stream
            except ResourceExhausted:
                print("Límite de API de Gemini alcanzado. Cambiando a Databricks como fallback.")
                self.gemini_available = False
                return self.generate_chat_response(chat_history)
            except Exception as e:
                print(f"Error inesperado con la API de Gemini: {e}. Cambiando a Databricks.")
                self.gemini_available = False
                return self.generate_chat_response(chat_history)

        elif model_to_use == 'databricks':
            try:
                # El historial para Databricks se adapta con el prompt del sistema dentro de la función.
                response_text = self._call_databricks_model(chat_history)
                return [response_text]
            except Exception as e:
                print(f"Error con la API de Databricks: {e}")
                return ["Lo siento, el servicio de respaldo de Databricks tampoco está disponible en este momento."]
        else:
            return ["Lo siento, el servicio de chat no está disponible. Por favor, verifica el estado de las APIs e inténtalo más tarde."]

    def _call_databricks_model(self, chat_history):
        """Llama al endpoint de Databricks Llama."""
        if not DATABRICKS_TOKEN or not DATABRICKS_ENDPOINT_URL:
            raise ValueError("Credenciales o URL de Databricks no configuradas.")

        headers = {
            'Authorization': f'Bearer {DATABRICKS_TOKEN}',
            'Content-Type': 'application/json'
        }
        
        # Esta función ahora añade el SYSTEM_PROMPT detallado.
        messages = self._adapt_history_for_databricks(chat_history)

        payload = {
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 4096 # Aumentado para respuestas de código más largas
        }

        response = requests.post(DATABRICKS_ENDPOINT_URL, headers=headers, json=payload, timeout=90)
        response.raise_for_status()
        response_data = response.json()

        if 'choices' in response_data and len(response_data['choices']) > 0:
            return response_data['choices'][0]['message']['content']
        raise ValueError(f"Respuesta inesperada de la API de Databricks: {response_data}")

    def _adapt_history_for_gemini(self, history):
        """
        Prepara el historial para Gemini, inyectando el prompt del sistema al principio
        para darle contexto al modelo en cada turno.
        """
        # Formato: [Instrucción de Sistema (como user), Respuesta afirmativa (como model), ...historial real]
        adapted_history = [
            {'role': 'user', 'parts': [SYSTEM_PROMPT]},
            {'role': 'model', 'parts': ["OK, I will follow these instructions."]}
        ]
        # Añade el resto del historial, convirtiendo 'assistant' a 'model'.
        adapted_history.extend([{'role': 'model' if item['role'] == 'assistant' else 'user', 'parts': [item['content']]} for item in history])
        return adapted_history
    
    def _adapt_history_for_databricks(self, history):
        """
        Prepara el historial para Databricks, usando un rol 'system' explícito.
        """
        # El primer mensaje es el rol del sistema con nuestras reglas.
        adapted_history = [{"role": "system", "content": SYSTEM_PROMPT}]
        # Añade el resto de la conversación (usuario y asistente).
        adapted_history.extend(history)
        return adapted_history

    def check_api_status(self):
        """Verifica la disponibilidad de las APIs de forma ligera."""
        try:
            genai.list_models()
            if not self.gemini_available:
                print("API de Gemini ha vuelto a estar disponible.")
                self.gemini_available = True
        except ResourceExhausted:
            self.gemini_available = False
        except Exception:
            self.gemini_available = False

        self.databricks_ping_ok = False
        if DATABRICKS_TOKEN and DATABRICKS_ENDPOINT_URL:
            try:
                response = requests.options(DATABRICKS_ENDPOINT_URL, headers={'Authorization': f'Bearer {DATABRICKS_TOKEN}'}, timeout=10)
                if response.status_code in [200, 204]:
                    self.databricks_ping_ok = True
            except requests.exceptions.RequestException:
                pass
        
        status = {
            "gemini": "available" if self.gemini_available else "limited",
            "databricks": "available" if self.databricks_ping_ok else "unavailable",
            "active_model": self.get_active_model()
        }
        print(f"Estado de APIs actualizado: {status}")
        return status
