# 🐛 Bug Fix: Quota Exceeded Error

## Problema Identificado

Quando processando múltiplos arquivos (60 no seu caso), a extensão apresentava o erro:
```
Uncaught (in promise) Error: Resource::kQuotaBytes quota exceeded
```

E o overlay ficava travado em "Processing" após o primeiro arquivo.

## Causa Raiz

A função `persistQueue()` estava salvando **dados binários completos** de todos os arquivos na fila no `chrome.storage.local`:

```javascript
// ❌ ANTES - Causava quota exceeded
data: q.data, // Salvando dados binários de TODOS os arquivos!
```

### Por que isso é um problema?

- `chrome.storage.local` tem limite de **~10MB** (10.485.760 bytes)
- Com 60 arquivos de ~200KB cada = **12MB** de dados
- Isso excede o limite e causa o erro de quota

## Solução Implementada

### 1. Removido dados binários da persistência

```javascript
// ✅ AGORA - Apenas metadata
queue: queue.map(q => ({
  name: q.name,
  type: q.type,
  status: q.status,
  size: q.size,
  // data: q.data, // REMOVIDO: Causa quota exceeded
  width: q.width,
  height: q.height
}))
```

### 2. Implicações

**Dados binários agora ficam apenas em memória:**
- ✅ Durante processamento normal: funciona perfeitamente
- ✅ Evita erro de quota exceeded
- ⚠️ Se o Service Worker reiniciar: fila será perdida (aceitável)

**A lógica existente já trata isso:**
```javascript
// Em kick() - já existia!
if (!next.data || next.data.length === 0) {
  console.log('[kick] Item without data, skipping:', next.name);
  next.status = 'skipped';
  // ...
}
```

### 3. Logs Adicionados

Para facilitar debug futuro, foram adicionados logs detalhados em:

**Content Script:**
- `[onMessage] POC:PROCESS RECEIVED` - quando recebe comando para processar
- Mostra arquivo, formato, meta e estado do overlay

**Background Script:**
- `[markDone]` - logs detalhados após completar arquivo
- `[sendProcessMessage]` - logs ao enviar comando para content script
- `[kick]` - logs ao buscar próximo arquivo

## Teste

1. **Recarregue a extensão** no Chrome
2. **Selecione os 60 arquivos** novamente
3. **Inicie o processamento**

### O que deve acontecer agora:

✅ Primeiro arquivo processa e faz download
✅ Overlay atualiza para "Image 2 of 60"
✅ Segundo arquivo processa e faz download
✅ Continua até o arquivo 60
✅ Overlay mostra "Completed!"

### Logs esperados no console:

```
[sendDone] arquivo1.jpg done position: 1 total: 60
[markDone] START - result: arquivo1.jpg status: done
[markDone] CALLING KICK AFTER 5000 ms
[kick] Called. isRunning: false isPaused: false
[sendProcessMessage] SENDING POC:PROCESS - File: arquivo2.jpg
[onMessage] POC:PROCESS RECEIVED - File: arquivo2.jpg
[processFile] start arquivo2.jpg
```

## Arquivos Modificados

- ✅ `background.js` - `persistQueue()` - removido dados binários
- ✅ `background.js` - `restoreQueueFromStorage()` - atualizado comentários
- ✅ `background.js` - `markDone()` - logs adicionados
- ✅ `background.js` - `sendProcessMessage()` - logs adicionados
- ✅ `content.js` - message listener - logs adicionados

## Data
2025-12-17
