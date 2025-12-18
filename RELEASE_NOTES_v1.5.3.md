# Release Notes - v1.5.3

**Data:** 2025-12-18

## 🐛 Correções de Bugs

### 1. **Fix: Fila para após primeira imagem com "Remover Fundo"**

**Problema:**
- Quando a opção "Remover Fundo" estava ativada, a extensão processava a primeira imagem com sucesso, mas a fila não avançava para as próximas imagens
- O Service Worker do Chrome estava sendo suspenso durante o delay entre imagens, causando perda da fila em memória

**Solução:**
- Modificado `content.js` para manter o keep-alive ativo durante **toda a fila**, não apenas durante cada imagem individual
- O keep-alive agora só é interrompido quando a **última imagem** é processada
- Isso previne a suspensão do Service Worker durante os delays entre imagens

**Arquivos modificados:**
- `content.js` - função `sendDone()` (linha ~748)
- `content.js` - handler `queue:cancel` (linha ~61)

**Documentação:**
- `BUG_FIX_KEEP_ALIVE.md`

---

### 2. **Melhoria: URL localizada por idioma do usuário**

**Problema:**
- A URL para criar a aba do worker estava hardcoded como `https://pt.vectorizer.ai/`
- Usuários de outros idiomas eram forçados a usar a versão em português

**Solução:**
- Modificado `background.js` para ler a preferência de idioma do usuário do `chrome.storage.local`
- A URL agora é construída dinamicamente baseada no idioma configurado na extensão
- Suporte para todos os 16 idiomas disponíveis no vectorizer.ai

**Arquivos modificados:**
- `background.js` - função `ensureTab()` (linha ~390)

**Idiomas suportados:**
- English (www), Português (pt), Español (es), Français (fr), Deutsch (de), Italiano (it)
- 日本語 (ja), 한국어 (ko), Русский (ru), 中文 (zh), हिन्दी (hi), Indonesia (id)
- Polski (pl), ไทย (th), Türkçe (tr), Tiếng Việt (vi)

---

## 📦 Arquivos de Distribuição

- `Batch_Vectorizer_Dist/` - Pasta com extensão pronta para uso
- `Batch_Vectorizer_v1.5.3.zip` - Arquivo ZIP para distribuição

## 🔄 Como Atualizar

1. Descompacte `Batch_Vectorizer_v1.5.3.zip`
2. No Chrome, vá em `chrome://extensions/`
3. Ative o "Modo do desenvolvedor"
4. Clique em "Carregar sem compactação"
5. Selecione a pasta `Batch_Vectorizer_Dist`

## 🧪 Testes Recomendados

1. **Teste de Keep-Alive:**
   - Selecione 3+ imagens
   - Ative "Remover Fundo"
   - Verifique que todas as imagens são processadas em sequência
   - Monitore os logs para confirmar: `[sendDone] More images pending, keeping keep-alive active`

2. **Teste de Localização:**
   - Altere o idioma da extensão no popup
   - Inicie o processamento
   - Verifique nos logs: `[ensureTab] Creating tab with locale URL: https://[idioma].vectorizer.ai/`

## 📝 Notas Técnicas

- O redirect automático do vectorizer.ai (baseado no idioma do navegador) não causa problemas
- O content script funciona em qualquer subdomínio (`*.vectorizer.ai`)
- O `workerTabId` permanece válido após redirects
