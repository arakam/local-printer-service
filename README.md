# 🖨️ Local Printer Service

Serviço local para impressão de etiquetas ZPL no Windows. Permite que aplicações web enviem comandos ZPL diretamente para impressoras USB instaladas no Windows, sem abrir janelas de impressão.

## ✨ Características

- ✅ API HTTP simples com Express
- ✅ Endpoint POST `/imprimir` para receber comandos ZPL
- ✅ Integração direta com impressoras Windows via spooler
- ✅ Modo de simulação para testes sem impressora
- ✅ Configuração flexível via variáveis de ambiente
- ✅ Logs detalhados e tratamento de erros
- ✅ Endpoints de status e listagem de impressoras
- ✅ CORS habilitado para requisições de navegadores web

## 🚀 Instalação

### Opção A — Instalador amigável (recomendado para usuários finais)

Não precisa de Node.js no PC do cliente.

1. No PC de desenvolvimento, gere o pacote:
   ```bash
   npm run build:release
   ```
2. Distribua a pasta `release/LocalPrinterService`
3. No PC do usuário, clique duas vezes em **Instalar.bat**
4. Escolha a impressora na lista

O instalador:
- Copia o `.exe` para `%LOCALAPPDATA%\LocalPrinterService`
- Cria `config.json` com porta/impressora
- Inicia o serviço
- Registra início automático no login do Windows
- Cria atalhos no Menu Iniciar (incluindo desinstalação)

> Opcional: se o [Inno Setup 6](https://jrsoftware.org/isinfo.php) estiver instalado, `npm run build:release` também gera `release/LocalPrinterService-Setup.exe`.

### Opção B — Desenvolvimento (código-fonte)

#### Pré-requisitos

- Node.js 18+ instalado
- Windows 10/11
- Impressora ZPL configurada no Windows (ex: Zebra, Datamax, etc.)

#### Passos

1. **Clone ou baixe o projeto:**
   ```bash
   git clone <url-do-repositorio>
   cd local-printer-service
   ```

2. **Instale as dependências:**
   ```bash
   npm install
   ```

3. **Configure `config.json` (recomendado) ou variáveis de ambiente:**
   ```bash
   copy installer\config.example.json config.json
   ```

## 🎯 Como Usar

### Iniciar o Serviço

```bash
# Modo normal (impressora real)
npm start

# Modo simulação (salva ZPL em arquivo)
SIMULACAO=true npm start

# Porta customizada
PORT=8080 npm start

# Impressora customizada
NOME_IMPRESSORA="Minha Impressora" npm start
```

### Endpoints Disponíveis

#### POST `/imprimir`
Envia comandos ZPL para impressão.

**Headers:**
```
Content-Type: text/plain
```

**Exemplo de requisição:**
```bash
curl -X POST http://localhost:9100/imprimir \
  -H "Content-Type: text/plain" \
  -d "^XA^FO50,50^ADN,36,20^FDHello World^FS^XZ"
```

**Resposta de sucesso (200):**
```json
{
  "success": true,
  "message": "Etiqueta enviada com sucesso"
}
```

**Resposta de erro (500):**
```json
{
  "error": "Impressora não encontrada"
}
```

#### GET `/status`
Verifica status do serviço.

**Resposta:**
```json
{
  "status": "online",
  "modo": "normal",
  "impressora": "ZDesigner ZD420-203dpi ZPL",
  "porta": 9100,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### GET `/impressoras`
Lista impressoras disponíveis no Windows.

**Resposta:**
```json
{
  "impressoras": [
    {
      "nome": "ZDesigner ZD420-203dpi ZPL",
      "status": "ready",
      "isDefault": false
    }
  ],
  "impressora_configurada": "ZDesigner ZD420-203dpi ZPL"
}
```

## 🧪 Modo de Teste/Simulação

Para testar sem impressora física:

```bash
# Ativar modo simulação
SIMULACAO=true npm start
```

No modo simulação:
- Os comandos ZPL são salvos em `saida_zpl.txt`
- Não há comunicação com impressoras reais
- Ideal para desenvolvimento e testes

## 🔧 Configuração

### Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | 9100 | Porta do servidor HTTP |
| `NOME_IMPRESSORA` | "ZDesigner ZD420-203dpi ZPL" | Nome da impressora Windows |
| `SIMULACAO` | false | Ativar modo simulação |

### Configurar Impressora

1. **Instalar driver da impressora no Windows**
2. **Verificar nome exato da impressora:**
   ```bash
   # Acesse: http://localhost:9100/impressoras
   # ou use o PowerShell:
   Get-Printer | Select-Object Name, PrinterStatus
   ```
3. **Configurar variável NOME_IMPRESSORA:**
   ```bash
   set NOME_IMPRESSORA="Nome Exato da Impressora"
   ```

## 🌐 Integração com ERP Web

### CORS Habilitado
O serviço possui **CORS habilitado** para permitir requisições de navegadores web:
- ✅ **Origem:** Qualquer origem (`*`)
- ✅ **Métodos:** GET, POST, OPTIONS
- ✅ **Headers:** Content-Type, Authorization
- ✅ **Credenciais:** Desabilitado (mais seguro)

### JavaScript/Fetch
```javascript
async function imprimirEtiqueta(zpl) {
  try {
    const response = await fetch('http://localhost:9100/imprimir', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: zpl
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('Sucesso:', result.message);
    } else {
      console.error('Erro:', result.error);
    }
  } catch (error) {
    console.error('Erro de rede:', error);
  }
}

// Exemplo de uso
const zpl = `^XA
^FO50,50^ADN,36,20^FDProduto: ABC123^FS
^FO50,100^ADN,36,20^FDPreço: R$ 29,90^FS
^XZ`;

imprimirEtiqueta(zpl);
```

### cURL
```bash
curl -X POST http://localhost:9100/imprimir \
  -H "Content-Type: text/plain" \
  -d "^XA^FO50,50^ADN,36,20^FDTeste^FS^XZ"
```

### PowerShell
```powershell
$zpl = "^XA^FO50,50^ADN,36,20^FDTeste PowerShell^FS^XZ"
Invoke-RestMethod -Uri "http://localhost:9100/imprimir" -Method POST -Body $zpl -ContentType "text/plain"
```

## 🔄 Iniciar com Windows

### Opção 1: PM2 (Recomendado)

1. **Instalar PM2 globalmente:**
   ```bash
   npm install -g pm2
   ```

2. **Criar arquivo de configuração `ecosystem.config.js`:**
   ```javascript
   module.exports = {
     apps: [{
       name: 'local-printer-service',
       script: 'index.js',
       cwd: 'C:\\caminho\\para\\local-printer-service',
       env: {
         NODE_ENV: 'production',
         PORT: 9100,
         NOME_IMPRESSORA: 'ZDesigner ZD420-203dpi ZPL',
         SIMULACAO: 'false'
       }
     }]
   };
   ```

3. **Iniciar com PM2:**
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

### Opção 2: Agendador de Tarefas do Windows

1. **Abrir Agendador de Tarefas**
2. **Criar Tarefa Básica:**
   - Nome: "Local Printer Service"
   - Disparador: "Quando o computador iniciar"
   - Ação: "Iniciar um programa"
   - Programa: `node`
   - Argumentos: `C:\\caminho\\para\\local-printer-service\\index.js`
   - Diretório inicial: `C:\\caminho\\para\\local-printer-service`

## 🐛 Solução de Problemas

### Erro: "Impressora não encontrada"
- Verifique se a impressora está instalada no Windows
- Use `GET /impressoras` para listar impressoras disponíveis
- Confirme o nome exato da impressora (case-sensitive)

### Erro: "EACCES" na porta
- A porta 9100 pode estar em uso
- Use `PORT=8080 npm start` para usar outra porta
- Execute como administrador se necessário

### Impressão não funciona
- Verifique se a impressora está online
- Teste impressão direta do Windows
- Use modo simulação para verificar se o ZPL está correto

### Modo simulação não salva arquivo
- Verifique permissões de escrita na pasta
- Execute como administrador se necessário

## 📝 Logs

O serviço gera logs detalhados no console:
- Requisições recebidas
- Dados ZPL enviados
- Status de impressão
- Erros detalhados

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

## 📄 Licença

MIT License - veja arquivo LICENSE para detalhes.

## 🆘 Suporte

Para suporte e dúvidas:
- Abra uma issue no GitHub
- Verifique a seção de solução de problemas
- Consulte os logs do serviço

---

**Desenvolvido para facilitar a integração entre ERPs web e impressoras de etiquetas no Windows** 🖨️✨
