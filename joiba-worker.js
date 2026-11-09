// Joiba AI — trabajador de inteligencia artificial
// Este archivo debe estar en la misma carpeta que index.html.
let generator = null;
let loading = false;

const send = (type, data = {}) => self.postMessage({ type, ...data });

async function loadModel() {
  if (loading) return;
  if (generator) {
    send('ready', { device: 'cached' });
    return;
  }
  loading = true;
  try {
    send('status', { text: 'Conectando con Hugging Face…' });
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
    if (typeof pipeline !== 'function') {
      throw new Error('No se pudo encontrar el cargador de modelos de Transformers.js.');
    }

    const progressCallback = (info) => {
      if (!info) return;
      send('progress', {
        status: info.status || '',
        file: info.file || info.name || '',
        progress: typeof info.progress === 'number' ? info.progress : null,
        loaded: info.loaded ?? null,
        total: info.total ?? null,
      });
    };

    let gpuAvailable = false;
    if (self.navigator && self.navigator.gpu) {
      try {
        send('status', { text: 'Comprobando la aceleración gráfica…' });
        const adapter = await self.navigator.gpu.requestAdapter();
        gpuAvailable = !!adapter;
      } catch (_) {
        gpuAvailable = false;
      }
    }

    if (gpuAvailable) {
      try {
        send('status', { text: 'Preparando el modelo con la tarjeta gráfica…' });
        generator = await pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
          device: 'webgpu',
          dtype: 'q4',
          progress_callback: progressCallback,
        });
        send('ready', { device: 'webgpu' });
        return;
      } catch (gpuError) {
        send('status', { text: 'La aceleración gráfica no está disponible. Intentaremos con el procesador…' });
        generator = null;
      }
    }

    send('status', { text: 'Preparando el modelo con el procesador del ordenador…' });
    generator = await pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: progressCallback,
    });
    send('ready', { device: 'wasm' });
  } catch (error) {
    generator = null;
    send('error', { message: error && error.message ? error.message : String(error) });
  } finally {
    loading = false;
  }
}

async function generate(messages) {
  if (!generator) {
    send('answerError', { message: 'La IA todavía no está preparada. Pulsa “Preparar IA”.' });
    return;
  }
  try {
    send('thinking');
    const output = await generator(messages, {
      max_new_tokens: 160,
      temperature: 0.65,
      top_p: 0.9,
      repetition_penalty: 1.08,
    });
    const generated = output && output[0] && output[0].generated_text;
    let answer = '';
    if (Array.isArray(generated)) {
      const last = generated[generated.length - 1];
      answer = last && typeof last.content === 'string' ? last.content.trim() : '';
    } else if (typeof generated === 'string') {
      answer = generated.trim();
    }
    send('answer', { text: answer || 'No pude preparar una respuesta. Prueba con una pregunta más corta.' });
  } catch (error) {
    send('answerError', { message: error && error.message ? error.message : String(error) });
  }
}

self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type === 'load') loadModel();
  if (data.type === 'generate') generate(data.messages || []);
};
