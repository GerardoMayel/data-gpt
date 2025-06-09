import os
import google.generativeai as genai
import requests
import json
from google.api_core.exceptions import ResourceExhausted

# --- Configuración de APIs desde el archivo .env ---
# Esta configuración se hace una sola vez al cargar el módulo.
try:
    genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
except Exception as e:
    print(f"ADVERTENCIA: No se pudo configurar la API de Gemini. Error: {e}")

DATABRICKS_TOKEN = os.getenv("DATABRICKS_TOKEN")
DATABRICKS_ENDPOINT_URL = os.getenv("DATABRICKS_ENDPOINT_URL")

class ModelManager:
    """
    Gestiona la selección de modelos (Gemini o Databricks) y maneja el estado de disponibilidad.
    """
    def __init__(self):
        self.gemini_available = True  # Asumimos que Gemini está disponible al inicio.
        self.databricks_ping_ok = False # Estado del ping a Databricks, se actualiza periódicamente.
        print("ModelManager inicializado.")
        # Hacemos un chequeo inicial al arrancar la app.
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
        Genera una respuesta usando el modelo activo.
        Maneja el streaming para Gemini y la llamada estándar para Databricks.
        """
        model_to_use = self.get_active_model()
        print(f"Intentando generar respuesta con: {model_to_use}")

        if model_to_use == 'gemini':
            try:
                model = genai.GenerativeModel('gemini-1.5-flash')
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
                response_text = self._call_databricks_model(chat_history)
                # Simulamos un stream (devolviendo una lista) para que el frontend lo maneje igual.
                return [response_text]
            except Exception as e:
                print(f"Error con la API de Databricks: {e}")
                return ["Lo siento, el servicio de respaldo de Databricks tampoco está disponible en este momento."]
        else:
            # Ningún modelo está disponible.
            return ["Lo siento, el servicio de chat no está disponible. Por favor, verifica el estado de las APIs e inténtalo más tarde."]

    def _call_databricks_model(self, chat_history):
        """Llama al endpoint de Databricks Llama."""
        if not DATABRICKS_TOKEN or not DATABRICKS_ENDPOINT_URL:
            raise ValueError("Credenciales o URL de Databricks no configuradas.")

        headers = {
            'Authorization': f'Bearer {DATABRICKS_TOKEN}',
            'Content-Type': 'application/json'
        }
        
        messages = self._adapt_history_for_databricks(chat_history)

        payload = {
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 2048
        }

        response = requests.post(DATABRICKS_ENDPOINT_URL, headers=headers, json=payload, timeout=90)
        response.raise_for_status()
        response_data = response.json()

        if 'choices' in response_data and len(response_data['choices']) > 0:
            return response_data['choices'][0]['message']['content']
        raise ValueError(f"Respuesta inesperada de la API de Databricks: {response_data}")

    def _adapt_history_for_gemini(self, history):
        """Ajusta el historial para el formato de Gemini (rol 'model' en lugar de 'assistant')."""
        return [{'role': 'model' if item['role'] == 'assistant' else 'user', 'parts': [item['content']]} for item in history]
    
    def _adapt_history_for_databricks(self, history):
        """Ajusta el historial para el formato de Databricks (puede incluir 'system')."""
        adapted_history = []
        if not any(item['role'] == 'system' for item in history):
             adapted_history.append({
                 "role": "system", 
                 "content": "You are a helpful coding assistant. Provide clear, concise, and correct code and explanations."
             })
        adapted_history.extend(history)
        return adapted_history

    def check_api_status(self):
        """Verifica la disponibilidad de las APIs de forma ligera."""
        # Verificar Gemini
        try:
            genai.list_models()
            if not self.gemini_available:
                print("API de Gemini ha vuelto a estar disponible.")
                self.gemini_available = True
        except ResourceExhausted:
            self.gemini_available = False
        except Exception:
            self.gemini_available = False

        # Verificar Databricks
        self.databricks_ping_ok = False
        if DATABRICKS_TOKEN and DATABRICKS_ENDPOINT_URL:
            try:
                response = requests.options(DATABRICKS_ENDPOINT_URL, headers={'Authorization': f'Bearer {DATABRICKS_TOKEN}'}, timeout=10)
                if response.status_code in [200, 204]:
                    self.databricks_ping_ok = True
            except requests.exceptions.RequestException:
                pass # Si falla el ping, databricks_ping_ok se queda en False
        
        status = {
            "gemini": "available" if self.gemini_available else "limited",
            "databricks": "available" if self.databricks_ping_ok else "unavailable",
            "active_model": self.get_active_model()
        }
        print(f"Estado de APIs actualizado: {status}")
        return status

