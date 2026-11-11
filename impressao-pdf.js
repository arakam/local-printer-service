const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const POWERSHELL = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
);

const TEMPO_LIMITE_MS = 120000;
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const CAMINHO_LOG = path.join(APP_DIR, 'impressao-pdf.log');

let emAndamento = 0;

function novoId() {
    return crypto.randomBytes(4).toString('hex');
}

function registrar(id, mensagem) {
    const texto = String(mensagem == null ? '' : mensagem).replace(/[\r\n]+/g, ' | ');
    const linha = `${new Date().toISOString()} [${id || '------'}] ${texto}\n`;
    try {
        if (fs.existsSync(CAMINHO_LOG) && fs.statSync(CAMINHO_LOG).size > LOG_MAX_BYTES) {
            const anterior = `${CAMINHO_LOG}.1`;
            try {
                fs.unlinkSync(anterior);
            } catch (error) {
                // O arquivo anterior pode estar aberto.
            }
            try {
                fs.renameSync(CAMINHO_LOG, anterior);
            } catch (error) {
                // Segue acrescentando no arquivo atual.
            }
        }
        fs.appendFileSync(CAMINHO_LOG, linha, 'utf8');
    } catch (error) {
        console.error(`Nao foi possivel gravar ${CAMINHO_LOG}: ${error.message}`);
    }
}

function resumirSaida(texto) {
    const limpo = String(texto || '').replace(/[\r\n]+/g, ' | ').trim();
    if (limpo.length <= 700) {
        return limpo;
    }
    return `${limpo.slice(0, 700)}...`;
}

class ErroImpressao extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function ehPdf(buffer) {
    return Buffer.isBuffer(buffer)
        && buffer.length >= 5
        && buffer[0] === 0x25
        && buffer[1] === 0x50
        && buffer[2] === 0x44
        && buffer[3] === 0x46;
}

function salvarPdf(buffer) {
    const arquivo = path.join(
        os.tmpdir(),
        `impressao-${crypto.randomBytes(16).toString('hex')}.pdf`
    );
    fs.writeFileSync(arquivo, buffer);
    return arquivo;
}

function decodificarSaida(buffer) {
    if (!buffer || buffer.length === 0) {
        return '';
    }
    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
        return buffer.toString('utf16le').replace(/^\uFEFF/, '');
    }
    if (buffer.length >= 4 && buffer[1] === 0x00 && buffer[3] === 0x00) {
        return buffer.toString('utf16le');
    }
    return buffer.toString('utf8');
}

function executar(script, env) {
    const id = crypto.randomBytes(8).toString('hex');
    const scriptPath = path.join(os.tmpdir(), `impressao-script-${id}.ps1`);
    const resultPath = path.join(os.tmpdir(), `impressao-resultado-${id}.json`);
    fs.writeFileSync(scriptPath, script);

    return new Promise((resolve, reject) => {
        const child = spawn(POWERSHELL, [
            '-NoProfile',
            '-NonInteractive',
            '-STA',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath
        ], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                ...env,
                RESULT_PATH: resultPath
            }
        });

        const stderrChunks = [];
        const stdoutChunks = [];
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, TEMPO_LIMITE_MS);

        child.stdout.on('data', (chunk) => {
            stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.stderr.on('data', (chunk) => {
            stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            fs.unlink(scriptPath, () => {});
            reject(error);
        });
        child.on('close', () => {
            clearTimeout(timer);
            let payload = null;
            try {
                payload = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
            } catch (error) {
                payload = null;
            }
            fs.unlink(resultPath, () => {});
            fs.unlink(scriptPath, () => {});
            resolve({
                timedOut,
                payload,
                stderr: decodificarSaida(Buffer.concat(stderrChunks)).trim(),
                stdout: decodificarSaida(Buffer.concat(stdoutChunks)).trim()
            });
        });
    });
}

function erroDoResultado(payload, stderr) {
    if (!payload) {
        return new ErroImpressao(
            500,
            stderr ? `Falha no spooler: ${stderr}` : 'Falha no spooler'
        );
    }
    if (payload.ok) {
        return null;
    }
    if (payload.code === 'printer') {
        return new ErroImpressao(404, 'Impressora não instalada');
    }
    if (payload.code === 'pdf') {
        return new ErroImpressao(400, 'PDF ausente ou inválido');
    }
    if (payload.code === 'spooler-stopped') {
        return new ErroImpressao(
            500,
            'Falha no spooler: O serviço de spooler do Windows não está em execução.'
        );
    }
    const detalhe = payload.message ? String(payload.message) : '';
    return new ErroImpressao(
        500,
        detalhe ? `Falha no spooler: ${detalhe}` : 'Falha no spooler'
    );
}

const SCRIPT_LISTAR = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Result([bool]$Ok, [string]$Code, [string]$Message, $Names) {
    $dict = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    $dict['ok'] = $Ok
    if ($Code) { $dict['code'] = $Code }
    if ($Message) { $dict['message'] = $Message }
    if ($null -ne $Names) { $dict['impressoras'] = $Names }
    Add-Type -AssemblyName System.Web.Extensions
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = 16777216
    $json = $ser.Serialize($dict)
    [System.IO.File]::WriteAllText($env:RESULT_PATH, $json, (New-Object System.Text.UTF8Encoding $false))
}

try {
    $svc = Get-Service -Name Spooler -ErrorAction Stop
    if ($svc.Status -ne 'Running') {
        Write-Result $false 'spooler-stopped' 'stopped' $null
        exit 1
    }
    Add-Type -AssemblyName System.Drawing
    $names = New-Object System.Collections.Generic.List[string]
    foreach ($n in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) {
        if ($null -ne $n) { [void]$names.Add([string]$n) }
    }
    Write-Result $true '' '' $names.ToArray()
    exit 0
} catch {
    $msg = $_.Exception.Message
    if ($_.Exception.InnerException -and $_.Exception.InnerException.Message) {
        $msg = $_.Exception.InnerException.Message
    }
    Write-Result $false 'spooler' $msg $null
    exit 1
}
`;

const SCRIPT_IMPRIMIR = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Result([bool]$Ok, [string]$Code, [string]$Message, $Extra) {
    $dict = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    $dict['ok'] = $Ok
    if ($Code) { $dict['code'] = $Code }
    if ($Message) { $dict['message'] = $Message }
    if ($Extra -is [System.Collections.IDictionary]) {
        foreach ($key in @($Extra.Keys)) {
            $dict[[string]$key] = $Extra[$key]
        }
    }
    Add-Type -AssemblyName System.Web.Extensions
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = 16777216
    $json = $ser.Serialize($dict)
    [System.IO.File]::WriteAllText($env:RESULT_PATH, $json, (New-Object System.Text.UTF8Encoding $false))
}

function Mensagem-Erro($err) {
    $msg = $err.Exception.Message
    if ($err.Exception.InnerException -and $err.Exception.InnerException.Message) {
        $msg = $err.Exception.InnerException.Message
    }
    return $msg
}

try {
    $svc = Get-Service -Name Spooler -ErrorAction Stop
} catch {
    Write-Result $false 'spooler' (Mensagem-Erro $_)
    exit 1
}
if ($svc.Status -ne 'Running') {
    Write-Result $false 'spooler-stopped' 'stopped'
    exit 1
}

$nome = [string]$env:PRINTER_NAME
if ([string]::IsNullOrEmpty($nome)) {
    Write-Result $false 'printer' 'ausente'
    exit 2
}

Add-Type -AssemblyName System.Drawing
$achou = $false
foreach ($n in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) {
    if ([string]$n -ceq $nome) { $achou = $true; break }
}
if (-not $achou) {
    Write-Result $false 'printer' 'ausente'
    exit 2
}

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$doc.PrinterSettings.PrinterName = $nome
if ($doc.PrinterSettings.PrinterName -cne $nome -or -not $doc.PrinterSettings.IsValid) {
    $doc.Dispose()
    Write-Result $false 'printer' 'ausente'
    exit 2
}

$global:paginas = New-Object System.Collections.Generic.List[object]
$global:indice = 0

try {
    try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
        $null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
        $null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]
        $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

        $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
        }) | Select-Object -First 1
        if (-not $asTaskGeneric) { throw 'PDF ausente ou invalido' }

        $asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
        }) | Select-Object -First 1
        if (-not $asTaskAction) { throw 'PDF ausente ou invalido' }

        function Await-Op($op, $type) {
            $method = $asTaskGeneric.MakeGenericMethod($type)
            $task = $method.Invoke($null, @($op))
            $task.Wait()
            if ($task.IsFaulted) { throw $task.Exception.InnerException }
            return $task.Result
        }
        function Await-Action($action) {
            $task = $asTaskAction.Invoke($null, @($action))
            $task.Wait()
            if ($task.IsFaulted) { throw $task.Exception.InnerException }
        }

        if (-not (Test-Path -LiteralPath $env:PDF_PATH)) { throw 'PDF ausente ou invalido' }
        $file = Await-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:PDF_PATH)) ([Windows.Storage.StorageFile])
        $pdf = Await-Op ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
        if ($pdf.PageCount -lt 1) { throw 'PDF ausente ou invalido' }
    } catch {
        Write-Result $false 'pdf' (Mensagem-Erro $_)
        exit 3
    }

    $dpi = 300
    for ($i = 0; $i -lt $pdf.PageCount; $i++) {
        $page = $null
        $bmp = $null
        $flat = $null
        $g = $null
        $net = $null
        $ras = $null
        try {
            $page = $pdf.GetPage([uint32]$i)
            $pxW = [uint32][Math]::Max(1, [Math]::Round($page.Size.Width / 96.0 * $dpi))
            $pxH = [uint32][Math]::Max(1, [Math]::Round($page.Size.Height / 96.0 * $dpi))
            $largura = [int][Math]::Max(1, [Math]::Round($page.Size.Width / 96.0 * 100.0))
            $altura = [int][Math]::Max(1, [Math]::Round($page.Size.Height / 96.0 * 100.0))
            $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
            $opts.DestinationWidth = $pxW
            $opts.DestinationHeight = $pxH
            $ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
            Await-Action ($page.RenderToStreamAsync($ras, $opts))
            $ras.Seek(0) | Out-Null
            $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStream($ras)
            $bmp = New-Object System.Drawing.Bitmap($net)
            $flat = New-Object System.Drawing.Bitmap($bmp.Width, $bmp.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
            $g = [System.Drawing.Graphics]::FromImage($flat)
            $g.Clear([System.Drawing.Color]::White)
            $g.DrawImage($bmp, 0, 0, $bmp.Width, $bmp.Height)
            $global:paginas.Add(@{
                Bitmap = $flat
                Largura = $largura
                Altura = $altura
            })
            $flat = $null
        } finally {
            if ($g) { $g.Dispose() }
            if ($bmp) { $bmp.Dispose() }
            if ($flat) { $flat.Dispose() }
            if ($net) { $net.Dispose() }
            if ($ras) { $ras.Dispose() }
            if ($page) { $page.Dispose() }
        }
    }

    if ($global:paginas.Count -lt 1) { throw 'PDF ausente ou invalido' }
    if ($doc.PrinterSettings.PrinterName -cne $nome) {
        Write-Result $false 'printer' 'ausente'
        exit 2
    }

    $jobId = [string]$env:JOB_ID
    if ([string]::IsNullOrEmpty($jobId)) { $jobId = 'sem-id' }
    $doc.DocumentName = "Etiqueta DANFE $jobId"
    $doc.OriginAtMargins = $false
    $papelPadrao = $doc.PrinterSettings.DefaultPageSettings.PaperSize
    if ($papelPadrao) {
        $doc.DefaultPageSettings.PaperSize = $papelPadrao
    }

    $doc.add_PrintPage({
        param($sender, $e)
        if ($global:indice -ge $global:paginas.Count) {
            $e.HasMorePages = $false
            return
        }
        $pagina = $global:paginas[$global:indice]
        $e.Graphics.Clear([System.Drawing.Color]::White)
        $bounds = $e.Graphics.VisibleClipBounds
        if ($bounds.Width -le 0 -or $bounds.Height -le 0) { $bounds = $e.PageBounds }
        $imgW = [single]$pagina.Bitmap.Width
        $imgH = [single]$pagina.Bitmap.Height
        $pageW = [single]$bounds.Width
        $pageH = [single]$bounds.Height
        if ($pageW -le 0 -or $pageH -le 0 -or $imgW -le 0 -or $imgH -le 0) {
            throw 'Area de impressao vazia'
        }
        $imgAspect = $imgW / $imgH
        $pageAspect = $pageW / $pageH
        if ($imgAspect -gt $pageAspect) {
            $drawW = $pageW
            $drawH = $pageW / $imgAspect
        } else {
            $drawH = $pageH
            $drawW = $pageH * $imgAspect
        }
        $x = [single]$bounds.X + (($pageW - $drawW) / 2)
        $y = [single]$bounds.Y + (($pageH - $drawH) / 2)
        $rect = New-Object System.Drawing.RectangleF($x, $y, $drawW, $drawH)
        $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $e.Graphics.DrawImage($pagina.Bitmap, $rect)
        $global:indice++
        $e.HasMorePages = ($global:indice -lt $global:paginas.Count)
    })

    $cronometro = [System.Diagnostics.Stopwatch]::StartNew()
    $doc.Print()
    $cronometro.Stop()

    $extra = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    $extra['paginas'] = [int]$global:paginas.Count
    $extra['printMs'] = [int]$cronometro.ElapsedMilliseconds
    $extra['impressoraEfetiva'] = [string]$doc.PrinterSettings.PrinterName
    $extra['documento'] = [string]$doc.DocumentName
    if ($papelPadrao) {
        $extra['papel'] = "$($papelPadrao.PaperName) $($papelPadrao.Width)x$($papelPadrao.Height)"
    }
    try {
        $info = Get-Printer -Name $nome -ErrorAction Stop
        $extra['driver'] = [string]$info.DriverName
        $extra['porta'] = [string]$info.PortName
        $extra['statusImpressora'] = [string]$info.PrinterStatus
    } catch {
        $extra['filaErro'] = $_.Exception.Message
    }

    $visto = $false
    $ultimoStatus = ''
    $ultimasImpressas = 0
    $trabalhos = New-Object System.Collections.Generic.List[object]
    $prazo = (Get-Date).AddSeconds(10)
    do {
        $trabalhos = New-Object System.Collections.Generic.List[object]
        try {
            $fila = @(Get-PrintJob -PrinterName $nome -ErrorAction Stop)
            $extra['fila'] = [int]$fila.Count
            foreach ($job in $fila) {
                $nomeDoc = [string]$job.DocumentName
                if ($nomeDoc -eq $doc.DocumentName -or $nomeDoc.Contains($jobId)) {
                    $item = New-Object 'System.Collections.Generic.Dictionary[string,object]'
                    $item['id'] = [int]$job.Id
                    $item['status'] = [string]$job.JobStatus
                    $item['total'] = [int]$job.TotalPages
                    $item['impressas'] = [int]$job.PagesPrinted
                    $item['documento'] = $nomeDoc
                    [void]$trabalhos.Add($item)
                    $visto = $true
                    $ultimoStatus = [string]$job.JobStatus
                    $ultimasImpressas = [int]$job.PagesPrinted
                }
            }
        } catch {
            $extra['filaErro'] = $_.Exception.Message
        }
        $partesStatus = @($ultimoStatus -split '[,\s]+' | Where-Object { $_ })
        $concluiu = $false
        if ($visto -and $trabalhos.Count -eq 0) { $concluiu = $true }
        if ($ultimasImpressas -gt 0) { $concluiu = $true }
        if (($partesStatus -contains 'Printed' -or $partesStatus -contains 'Complete') -and -not ($partesStatus -contains 'Printing')) { $concluiu = $true }
        if ($partesStatus -contains 'Error' -or $partesStatus -contains 'Offline' -or $partesStatus -contains 'Paperout' -or $partesStatus -contains 'Blocked' -or $partesStatus -contains 'Paused') { $concluiu = $true }
        if ($concluiu) { break }
        if ((Get-Date) -ge $prazo) { break }
        Start-Sleep -Milliseconds 500
    } while ($true)

    $extra['trabalhos'] = $trabalhos.ToArray()
    $extra['ultimoStatus'] = $ultimoStatus
    $extra['impressas'] = $ultimasImpressas
    $partesFinais = @($ultimoStatus -split '[,\s]+' | Where-Object { $_ })
    if ($partesFinais -contains 'Error' -or $partesFinais -contains 'Offline' -or $partesFinais -contains 'Paperout' -or $partesFinais -contains 'Blocked' -or $partesFinais -contains 'Paused') {
        Write-Result $false 'spooler' "Trabalho parado na fila: $ultimoStatus" $extra
        exit 1
    }
    if ($trabalhos.Count -gt 0 -and $ultimasImpressas -eq 0 -and ($partesFinais -contains 'Printing')) {
        Write-Result $false 'spooler' "Trabalho ficou em $ultimoStatus com 0 paginas impressas" $extra
        exit 1
    }
    Write-Result $true '' '' $extra
    exit 0
} catch {
    Write-Result $false 'spooler' (Mensagem-Erro $_)
    exit 1
} finally {
    if ($global:paginas) {
        foreach ($pagina in $global:paginas) {
            if ($pagina.Bitmap) { $pagina.Bitmap.Dispose() }
        }
    }
    if ($doc) { $doc.Dispose() }
}
`;

async function listarImpressoras() {
    const resultado = await executar(SCRIPT_LISTAR, {});
    if (resultado.timedOut) {
        throw new ErroImpressao(500, 'Falha no spooler: tempo esgotado');
    }
    const erro = erroDoResultado(resultado.payload, resultado.stderr);
    if (erro) {
        throw erro;
    }
    const lista = resultado.payload && resultado.payload.impressoras;
    if (!Array.isArray(lista)) {
        return [];
    }
    return lista.map((nome) => String(nome));
}

function descreverResultado(resultado) {
    const payload = resultado && resultado.payload;
    if (!payload) {
        return `sem resultado do Windows stdout="${resumirSaida(resultado && resultado.stdout)}" stderr="${resumirSaida(resultado && resultado.stderr)}"`;
    }
    const trabalhos = Array.isArray(payload.trabalhos) ? payload.trabalhos : [];
    const fila = trabalhos.map((job) => {
        return `#${job.id} status=${job.status} paginas=${job.total} impressas=${job.impressas} doc="${job.documento}"`;
    }).join('; ');
    return [
        `ok=${payload.ok === true}`,
        payload.code ? `code=${payload.code}` : '',
        payload.message ? `mensagem="${payload.message}"` : '',
        payload.paginas != null ? `paginas=${payload.paginas}` : '',
        payload.printMs != null ? `printMs=${payload.printMs}` : '',
        payload.impressoraEfetiva ? `impressoraEfetiva="${payload.impressoraEfetiva}"` : '',
        payload.driver ? `driver="${payload.driver}"` : '',
        payload.porta ? `porta="${payload.porta}"` : '',
        payload.papel ? `papel="${payload.papel}"` : '',
        payload.ultimoStatus ? `ultimoStatus="${payload.ultimoStatus}"` : '',
        payload.documento ? `documento="${payload.documento}"` : '',
        payload.fila != null ? `fila=${payload.fila}` : '',
        payload.filaErro ? `filaErro="${payload.filaErro}"` : '',
        trabalhos.length ? `trabalhos=${fila}` : 'trabalhos=nenhum com este id',
        resultado.timedOut ? 'timeout=sim' : ''
    ].filter(Boolean).join(' ');
}

async function imprimirPdf(buffer, impressora, id) {
    const registro = id || novoId();
    emAndamento += 1;
    const simultaneos = emAndamento;
    let arquivo = null;
    let enviou = false;
    try {
        registrar(registro, `processando emAndamento=${simultaneos} bytes=${Buffer.isBuffer(buffer) ? buffer.length : 0} impressora=${JSON.stringify(impressora)}`);
        if (simultaneos > 1) {
            registrar(registro, 'sobreposicao: outro PDF ainda esta sendo enviado ao spooler');
        }
        if (!ehPdf(buffer)) {
            throw new ErroImpressao(400, 'PDF ausente ou inválido');
        }
        if (typeof impressora !== 'string' || impressora.trim() === '') {
            throw new ErroImpressao(400, 'Impressora não informada');
        }

        const instaladas = await listarImpressoras();
        registrar(registro, `impressoras instaladas (${instaladas.length}): ${instaladas.map((nome) => JSON.stringify(nome)).join(', ') || 'nenhuma'}`);
        if (!instaladas.includes(impressora)) {
            throw new ErroImpressao(404, 'Impressora não instalada');
        }

        arquivo = salvarPdf(buffer);
        registrar(registro, `pdf gravado bytes=${buffer.length} arquivo=${arquivo}`);
        const inicioSpooler = Date.now();
        const resultado = await executar(SCRIPT_IMPRIMIR, {
            PDF_PATH: arquivo,
            PRINTER_NAME: impressora,
            JOB_ID: registro
        });
        registrar(registro, `spooler duracaoMs=${Date.now() - inicioSpooler} ${descreverResultado(resultado)}`);
        if (resultado.stdout) {
            registrar(registro, `stdout ${resumirSaida(resultado.stdout)}`);
        }
        if (resultado.stderr) {
            registrar(registro, `stderr ${resumirSaida(resultado.stderr)}`);
        }
        if (resultado.timedOut) {
            throw new ErroImpressao(500, 'Falha no spooler: tempo esgotado');
        }
        const erro = erroDoResultado(resultado.payload, resultado.stderr);
        if (erro) {
            throw erro;
        }
        enviou = true;
        const trabalhos = resultado.payload && Array.isArray(resultado.payload.trabalhos)
            ? resultado.payload.trabalhos
            : [];
        if (trabalhos.length === 0) {
            registrar(registro, 'aviso: o Print() retornou sem erro, mas a fila nao mostrou este documento. O HTTP 200 nao garante papel');
        } else {
            const comErro = trabalhos.filter((job) => /error|offline|blocked|paused|deleting/i.test(String(job.status || '')));
            if (comErro.length) {
                registrar(registro, `aviso: trabalho entrou na fila com status de problema: ${comErro.map((job) => job.status).join(', ')}`);
            }
        }
    } finally {
        emAndamento = Math.max(0, emAndamento - 1);
        if (arquivo && enviou) {
            try {
                fs.unlinkSync(arquivo);
            } catch (error) {
                registrar(registro, `aviso: nao foi possivel apagar o pdf temporario ${arquivo}`);
            }
        } else if (arquivo) {
            registrar(registro, `pdf temporario mantido para conferencia: ${arquivo}`);
        }
    }
}

module.exports = {
    ehPdf,
    salvarPdf,
    listarImpressoras,
    imprimirPdf,
    novoId,
    registrar,
    caminhoLog: CAMINHO_LOG,
    scripts: {
        listar: SCRIPT_LISTAR,
        imprimir: SCRIPT_IMPRIMIR
    }
};
