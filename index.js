const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Pasta gravável: ao lado do .exe (pkg) ou do projeto (dev)
const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(APP_DIR, 'config.json');

function carregarConfig() {
    const padrao = {
        PORT: 9100,
        NOME_IMPRESSORA: 'NOME-IMPRESSORA',
        SIMULACAO: false
    };

    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const arquivo = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            return { ...padrao, ...arquivo };
        }
    } catch (error) {
        console.log(`Aviso: não foi possível ler config.json (${error.message}). Usando padrões.`);
    }

    return padrao;
}

const fileConfig = carregarConfig();

// Variáveis de ambiente têm prioridade sobre config.json
const PORT = Number(process.env.PORT || fileConfig.PORT || 9100);
const NOME_IMPRESSORA = process.env.NOME_IMPRESSORA || fileConfig.NOME_IMPRESSORA;
const SIMULACAO =
    process.env.SIMULACAO === 'true' ||
    process.env.SIMULACAO === '1' ||
    (process.env.SIMULACAO === undefined &&
        (fileConfig.SIMULACAO === true || fileConfig.SIMULACAO === 'true' || fileConfig.SIMULACAO === '1'));

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false
}));

app.use(bodyParser.text({ type: 'text/plain' }));

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

async function imprimirZPL(zplData) {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        const tempFile = path.join(APP_DIR, 'temp_zpl.txt');
        fs.writeFileSync(tempFile, zplData, 'utf8');

        const psCommand = `copy "${tempFile}" "\\\\localhost\\${NOME_IMPRESSORA}"`;

        try {
            console.log(`Tentando imprimir na impressora: ${NOME_IMPRESSORA}`);
            const { stderr } = await execAsync(psCommand);

            if (stderr && stderr.trim()) {
                console.log('Stderr:', stderr);
            }

            try {
                fs.unlinkSync(tempFile);
            } catch (cleanupError) {
                console.log('Aviso: Não foi possível limpar arquivo temporário');
            }

            return { success: true, message: 'Etiqueta enviada com sucesso' };
        } catch (psError) {
            console.log('Erro PowerShell:', psError.message);

            try {
                const lprCommand = `echo "${zplData.replace(/"/g, '\\"')}" | lpr -P "${NOME_IMPRESSORA}"`;
                await execAsync(lprCommand);
                return { success: true, message: 'Etiqueta enviada com sucesso (método lpr)' };
            } catch (lprError) {
                console.log('Erro lpr:', lprError.message);

                try {
                    fs.writeFileSync(tempFile, zplData, 'utf8');
                    const copyCommand = `copy "${tempFile}" "\\\\localhost\\${NOME_IMPRESSORA}"`;
                    await execAsync(copyCommand);
                    fs.unlinkSync(tempFile);
                    return { success: true, message: 'Etiqueta enviada com sucesso (método copy)' };
                } catch (copyError) {
                    console.log('Erro copy:', copyError.message);
                    throw new Error(`Falha ao imprimir. Verifique se a impressora "${NOME_IMPRESSORA}" está instalada e acessível. Erros: PS=${psError.message}, LPR=${lprError.message}, COPY=${copyError.message}`);
                }
            }
        }
    } catch (error) {
        throw new Error(`Erro ao imprimir: ${error.message}`);
    }
}

function simularImpressao(zplData) {
    try {
        const arquivoSaida = path.join(APP_DIR, 'saida_zpl.txt');
        const conteudo = `\n\n=== ZPL Recebido em ${new Date().toISOString()} ===\n${zplData}\n=== Fim do ZPL ===\n`;

        fs.appendFileSync(arquivoSaida, conteudo, 'utf8');

        return { success: true, message: 'ZPL salvo em saida_zpl.txt (modo simulação)' };
    } catch (error) {
        throw new Error(`Erro ao salvar ZPL: ${error.message}`);
    }
}

app.post('/imprimir', async (req, res) => {
    try {
        const zplData = req.body;

        if (!zplData || zplData.trim() === '') {
            return res.status(400).json({
                error: 'Dados ZPL não fornecidos ou vazios'
            });
        }

        console.log(`ZPL recebido (${zplData.length} caracteres):`);
        console.log('--- Início ZPL ---');
        console.log(zplData);
        console.log('--- Fim ZPL ---');

        let resultado;

        if (SIMULACAO) {
            console.log('Modo SIMULAÇÃO ativado - salvando ZPL em arquivo');
            resultado = simularImpressao(zplData);
        } else {
            console.log(`Enviando para impressora: ${NOME_IMPRESSORA}`);
            resultado = await imprimirZPL(zplData);
        }

        console.log(resultado.message);
        res.status(200).json(resultado);
    } catch (error) {
        console.error('Erro:', error.message);
        res.status(500).json({
            error: error.message
        });
    }
});

app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        modo: SIMULACAO ? 'simulação' : 'normal',
        impressora: NOME_IMPRESSORA,
        porta: PORT,
        config: CONFIG_PATH,
        timestamp: new Date().toISOString()
    });
});

app.get('/impressoras', async (req, res) => {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        const command = `powershell -Command "Get-Printer | Select-Object Name, PrinterStatus | ConvertTo-Json"`;

        try {
            const { stdout } = await execAsync(command);
            const printers = JSON.parse(stdout);

            res.json({
                impressoras: Array.isArray(printers) ? printers.map(p => ({
                    nome: p.Name,
                    status: p.PrinterStatus,
                    isDefault: false
                })) : [{
                    nome: printers.Name,
                    status: printers.PrinterStatus,
                    isDefault: false
                }],
                impressora_configurada: NOME_IMPRESSORA
            });
        } catch (psError) {
            res.json({
                impressoras: [{
                    nome: NOME_IMPRESSORA,
                    status: 'unknown',
                    isDefault: true
                }],
                impressora_configurada: NOME_IMPRESSORA,
                aviso: 'Não foi possível listar impressoras automaticamente. Verifique manualmente no Painel de Controle.'
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint não encontrado',
        endpoints_disponiveis: [
            'POST /imprimir - Enviar ZPL para impressão',
            'GET /status - Status do serviço',
            'GET /impressoras - Listar impressoras disponíveis'
        ]
    });
});

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('LOCAL PRINTER SERVICE INICIADO');
    console.log('='.repeat(60));
    console.log(`Porta: ${PORT}`);
    console.log(`Impressora: ${NOME_IMPRESSORA}`);
    console.log(`Modo: ${SIMULACAO ? 'SIMULACAO (arquivo saida_zpl.txt)' : 'NORMAL (impressora real)'}`);
    console.log(`Pasta: ${APP_DIR}`);
    console.log(`Config: ${CONFIG_PATH}`);
    console.log(`URL: http://localhost:${PORT}`);
    console.log('='.repeat(60));
    console.log('Endpoints disponíveis:');
    console.log(`  POST http://localhost:${PORT}/imprimir`);
    console.log(`  GET  http://localhost:${PORT}/status`);
    console.log(`  GET  http://localhost:${PORT}/impressoras`);
    console.log('='.repeat(60));
});

process.on('uncaughtException', (error) => {
    console.error('Erro não capturado:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('Promise rejeitada não tratada:', reason);
    process.exit(1);
});
