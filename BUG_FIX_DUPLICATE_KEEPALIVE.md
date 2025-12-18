# 🐛 Bug Fix: Fila Para Após Primeiro Arquivo com Remove Background (v2)

## Data
2025-12-18

## Problema Reportado
Quando a opção "Remover Fundo" está ativada:
- ✅ Primeira imagem é processada corretamente
- ✅ Download é feito com sucesso
- ❌ **Fila NÃO avança para a próxima imagem**
- ❌ Extensão fica "travada"

**Comportamento observado**: Funciona apenas quando o DevTools está aberto!

**Sem "Remover Fundo"**: Funciona perfeitamente.

## Logs do Erro
```
[markDone] START - result: A single isolated vector icon... status: done
[markDone] Queue before: Array(0) ← QUEUE VAZIA!
[markDone] WARNING: Item not found in queue!
[markDone] Queue after update: Array(0)
[kick] Called. isRunning: false isPaused: false queue.length: 0
[kick] No pending items, returning
```

## Causa Raiz Identificada

### Análise do Código

O arquivo `content.js` tinha **DUAS funções com o mesmo nome `startKeepAlive`**:

1. **Linha 121** - Versão sem parâmetros:
```javascript
function startKeepAlive() {
  if (keepAliveInterval) return; // Already running
  // Pinga a cada 10s indefinidamente
  keepAliveInterval = setInterval(() => { ... }, 10000);
}
```

2. **Linha 1141** - Versão com parâmetros (para auto-pause):
```javascript
function startKeepAlive(durationMs) {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  if (durationMs <= 0) return;  // ← Problema!
  // Pinga a cada 20s por uma duração específica
  keepAliveTimer = setInterval(() => { ... }, 20000);
}
```

### O Problema

Como JavaScript executa o código de cima para baixo, a **segunda função sobrescreve a primeira**.

Quando `processFile()` chama `startKeepAlive()` na linha 151 (sem parâmetros):
1. A versão `startKeepAlive(durationMs)` é chamada com `durationMs = undefined`
2. A verificação `if (durationMs <= 0)` retorna `false` (pois `undefined <= 0` é `false`)
3. Mas o setTimeout usa `durationMs + 5000` = `NaN`, então **o timer nunca para corretamente**
4. As duas funções usam **variáveis diferentes** (`keepAliveInterval` vs `keepAliveTimer`)
5. Quando `stopKeepAlive()` é chamado, ele para apenas `keepAliveInterval`, não `keepAliveTimer`

### Por que funciona com DevTools aberto?

O DevTools mantém o Service Worker ativo indefinidamente, então o keep-alive não era necessário.

## Solução Implementada

### 1. Renomeada a segunda função

**Antes:** `startKeepAlive(durationMs)`
**Depois:** `startKeepAliveForDuration(durationMs)`

### 2. Atualizadas as chamadas

- Linha 113: `startKeepAlive(msg.duration)` → `startKeepAliveForDuration(msg.duration)`
- Linha 682: `startKeepAlive(3600000)` → `startKeepAliveForDuration(3600000)`
- Linha 1133: `startKeepAlive(endTime - Date.now())` → `startKeepAliveForDuration(endTime - Date.now())`

### 3. Adicionada verificação para undefined

```javascript
if (!durationMs || durationMs <= 0) return;  // Agora verifica undefined também
```

## Arquivos Modificados

- `content.js`:
  - Linha 113: Chamada de `queue:wait` handler
  - Linha 682: Chamada na página de pricing
  - Linha 1133: Chamada no `startAutoPauseCountdown`
  - Linhas 1141-1163: Renomeada para `startKeepAliveForDuration`

## Estrutura Final das Funções Keep-Alive

```
┌─────────────────────────────────────┐
│ startKeepAlive()                     │ ← Sem parâmetros
│ Usa: keepAliveInterval               │ ← Pinga a cada 10s
│ Para: stopKeepAlive()                │ ← Indefinidamente
│ Usado em: processFile()              │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ startKeepAliveForDuration(ms)        │ ← Com duração
│ Usa: keepAliveTimer                  │ ← Pinga a cada 20s
│ Para: automaticamente após duração   │ ← Por tempo limitado
│ Usado em: queue:wait, pricing,       │
│           startAutoPauseCountdown    │
└─────────────────────────────────────┘
```

## Como Testar

1. Selecione 2 ou mais imagens
2. Ative a opção "Remover Fundo"
3. **FECHE o DevTools**
4. Inicie o processamento
5. Verifique nos logs (após reabrir DevTools se necessário):
   - `[startKeepAlive] Starting keep-alive pings every 10s` ← Ao iniciar
   - `[keepAlive] Ping successful` ← A cada 10 segundos
   - `[sendDone] More images pending, keeping keep-alive active` ← Após cada imagem
   - `[sendDone] Last image processed, stopping keep-alive` ← Após última imagem

## Resultado Esperado

- ✅ Todas as imagens são processadas em sequência
- ✅ O Service Worker permanece ativo durante todo o processamento
- ✅ A fila não é perdida entre imagens
- ✅ Funciona mesmo com DevTools fechado
