# Modo DEV - Desenvolvimento sem Licença

## 🔧 Como Usar

### **Ativar Modo DEV:**

1. Abra o arquivo `popup.js`
2. Localize as linhas (próximo ao topo, após a inicialização):

```javascript
// ========== DEV MODE ==========
// Set to true to bypass license check during development
// IMPORTANT: Set to false before distribution!
const DEV_MODE = true;  // ← Altere aqui
// ==============================
```

3. Certifique-se de que `DEV_MODE = true`
4. Recarregue a extensão no Chrome

### **Desativar Modo DEV (para distribuição):**

```javascript
const DEV_MODE = false;  // ← IMPORTANTE: false para produção!
```

## ✅ Benefícios

- ✅ Não precisa inserir license key durante desenvolvimento
- ✅ Não precisa fazer chamadas à API do Gumroad
- ✅ Testes mais rápidos e eficientes
- ✅ Funciona offline

## ⚠️ IMPORTANTE

### **NUNCA distribua a extensão com DEV_MODE = true!**

Antes de criar o build de distribuição:

1. **Verifique** que `DEV_MODE = false` em `popup.js`
2. **Execute** o script de ofuscação
3. **Teste** a versão ofuscada para garantir que a licença funciona

## 🔍 Como Verificar

### **Modo DEV Ativo:**
- Console mostra: `[DEV MODE] License check bypassed`
- Modal de licença NÃO aparece
- Extensão funciona imediatamente

### **Modo Produção:**
- Modal de licença aparece
- Requer chave válida do Gumroad
- Verifica licença via API

## 📝 Checklist Antes da Distribuição

- [ ] `DEV_MODE = false` em `popup.js`
- [ ] Testar verificação de licença
- [ ] Executar `prepare_dist.ps1` para ofuscar
- [ ] Testar versão ofuscada
- [ ] Criar ZIP para distribuição

## 🎯 Workflow Recomendado

### Durante Desenvolvimento:
```javascript
const DEV_MODE = true;  // Desenvolvimento
```

### Antes de Commitar:
```javascript
const DEV_MODE = false;  // Produção
```

### Ou use Git para ignorar mudanças locais:
```bash
# Mantém DEV_MODE = true localmente sem commitar
git update-index --skip-worktree popup.js
```

## 🔐 Segurança

O modo DEV:
- ✅ Está apenas no código fonte (não ofuscado)
- ✅ Será ofuscado no build de produção
- ✅ Não afeta a segurança se `DEV_MODE = false`
- ⚠️ **NUNCA** deixe `true` em produção!

## 💡 Dica

Adicione um lembrete no seu processo de build:

```powershell
# No início do prepare_dist.ps1
Write-Host "⚠️  ATENÇÃO: Verifique se DEV_MODE = false em popup.js!" -ForegroundColor Yellow
Read-Host "Pressione Enter para continuar..."
```
