# Instalação do Casa

[Voltar ao README](../README.md) · [Arquitetura e permissões](ARCHITECTURE.md)

Este guia usa a versão **0.2.0** e o app ID `com.soar.tv.launcher`. O único ambiente com integração completa comprovada é a LG **43UR7800PSA**, webOS TV 25, SDK 10.3.2 e firmware 33.31.75. Outros ambientes precisam de validação própria.

O Casa é instalado como um app comum. A Home LG, o botão Home e a inicialização permanecem sob controle do webOS. Obter root, remapear o controle e substituir a Home não fazem parte deste guia.

## Preparar o computador

Para instalar um IPK já pronto, tenha Node.js/npm, a CLI webOS e o arquivo da [release v0.2.0](https://github.com/SmookeyDev/casa-webos-launcher/releases/tag/v0.2.0). O projeto de desenvolvimento exige Node.js **22.12 ou posterior**.

```sh
npm install --global @webos-tools/cli@3.2.6
ares -V
ares-config --profile tv
```

Se você clonou o projeto e executou `npm ci`, também pode usar os executáveis locais com `npx`, por exemplo `npx ares-setup-device`. A CLI instalada localmente é a mesma versão fixada no projeto. [Referência de instalação da CLI LG](https://webostv.developer.lge.com/develop/tools/cli-installation).

TV e computador precisam se alcançar pela rede local. Nos exemplos, `casa-tv` é apenas o nome cadastrado na CLI, e `TV_IP` significa o endereço da sua própria TV. Nenhuma chave ou conta é fornecida pelo repositório.

## 1. TV sem root: Developer Mode

Use o caminho oficial da LG para instalar e testar apps. **Se a TV já usa root/Homebrew Channel, siga a seção 2.** O projeto Homebrew orienta a preservar seu próprio ambiente SSH em vez de instalar Developer Mode por cima dele. [Orientação do webOS Homebrew](https://www.webosbrew.org/pages/sdk-configuration).

1. Na TV, instale **Developer Mode** pela loja LG e entre com sua conta LG Developer.
2. Ative **Dev Mode Status** e conclua a reinicialização solicitada.
3. Abra novamente o Developer Mode e ative **Key Server**.
4. No computador, cadastre a TV com o assistente:

```sh
ares-setup-device
```

Use estes dados no cadastro:

| Campo | Valor |
| --- | --- |
| Nome | `casa-tv` |
| Host | O IP mostrado na sua TV |
| Porta | `9922` |
| Usuário | `prisoner` |

Obtenha a chave pelo recurso oficial e informe a passphrase exibida na TV quando a CLI pedir:

```sh
ares-novacom --device casa-tv --getkey
ares-device --device casa-tv --system-info
```

A sessão Developer Mode tem duração limitada. Confira **Remain Session** e utilize **EXTEND** conforme a orientação da LG. Não publique sua chave ou passphrase. [Procedimento oficial do Developer Mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app).

Na pasta em que salvou o IPK, instale e abra:

```sh
ares-install --device casa-tv ./com.soar.tv.launcher_0.2.0_all.ipk
ares-launch --device casa-tv com.soar.tv.launcher
```

A instalação pelo Developer Mode não concede automaticamente acesso a APIs privadas. O Casa tenta manter uma interface utilizável com os apps conhecidos e dados em cache. Catálogo completo, novas descobertas e informações do painel dependem das permissões efetivas do firmware; esta combinação sem root ainda não foi validada em hardware separado.

## 2. TV com root já existente

Este fluxo pressupõe **Homebrew Channel e acesso SSH já configurados por você**. Ele não instala Homebrew, não explora vulnerabilidades e não obtém root.

Preserve a autenticação existente e use o gerenciador de apps que já utiliza, se ele aceitar instalação manual de IPK. O Casa não está publicado em um feed do Homebrew Channel. Para instalar pela CLI, execute `ares-setup-device` e cadastre:

| Campo | Valor |
| --- | --- |
| Nome | `casa-tv` |
| Host | O IP da sua TV |
| Porta | A porta SSH já configurada; normalmente `22` |
| Usuário | O usuário da sessão já existente; normalmente `root` |
| Chave privada | Sua chave SSH já autorizada nessa TV |

Não use a etapa `ares-novacom --getkey` do Developer Mode nesse fluxo. O [guia do Homebrew](https://www.webosbrew.org/pages/sdk-configuration) descreve a configuração com a chave SSH existente.

Com o dispositivo cadastrado, a instalação e a abertura são iguais:

```sh
ares-install --device casa-tv ./com.soar.tv.launcher_0.2.0_all.ipk
ares-launch --device casa-tv com.soar.tv.launcher
```

Teste o pacote normal antes de alterar permissões: confirme se abre, se lança um aplicativo instalado e quais informações aparecem na central. **Instalar por uma sessão root não faz o serviço do Casa executar como root.** O serviço empacotado continua usando a identidade e o jail que a plataforma atribui a ele.

## 3. Opcional: habilitar o catálogo nativo

No firmware validado, o catálogo completo exigiu o grupo LS2 `applications.internal`. O script [`scripts/provision-native-catalog.cjs`](../scripts/provision-native-catalog.cjs) concede esse grupo somente à identidade **`com.soar.tv.launcher.service`**, usando o manifesto instalado do Casa.

Essa etapa exige uma sessão com UID 0 **já disponível**. Ela não fornece root, não remove o jail, não usa `trustLevel:trusted`, não concede o grupo ao app web e não instala tarefa de boot. Também não concede, por si só, toda API privada que outro firmware possa exigir. O grupo é mais amplo que as duas consultas usadas pelo Casa; leia o [contrato nativo e o alcance da permissão](NATIVE-SERVICE.md) antes de aplicar.

Antes de aplicar:

1. Instale o IPK e feche o Casa.
2. Use o script correspondente à versão que você instalou; confira o código antes de executar.
3. Configure os exemplos com **seu** IP, usuário e chave. `TV_USER` precisa representar a sessão root existente; `prisoner` não atende esse requisito.

### Linux/macOS ou outro shell POSIX

Execute a partir da raiz do repositório:

```sh
TV_IP="IP_DA_SUA_TV"
SSH_KEY="$HOME/.ssh/sua-chave-da-tv"
TV_USER="root"

ssh -i "$SSH_KEY" "$TV_USER@$TV_IP" "node -" < scripts/provision-native-catalog.cjs
```

### Windows PowerShell

```powershell
$TV_IP = "IP_DA_SUA_TV"
$SSH_KEY = Join-Path $HOME ".ssh\sua-chave-da-tv"
$TV_USER = "root"

Get-Content -Raw -LiteralPath .\scripts\provision-native-catalog.cjs |
    ssh -i "$SSH_KEY" "${TV_USER}@${TV_IP}" "node -"
```

O script é enviado pela entrada padrão do Node da TV; não é necessário copiar uma ferramenta permanente para ela. Se a sessão utiliza outra porta SSH, inclua `-p SUA_PORTA` no comando `ssh`.

O provisionamento altera os arquivos de permissões LS2 associados ao app instalado e mantém backup para reversão; não modifica imagens do firmware. O script aceita somente estes prefixos:

| Prefixo | Registro consultado |
| --- | --- |
| `/var/luna-service2-dev` | Manifestos LS2 de desenvolvimento |
| `/var/luna-service2` | Manifestos LS2 da instalação normal |

Sem `--prefix`, ele escolhe automaticamente quando encontra o manifesto do Casa em apenas um deles. Se encontrar os dois, recusa a alteração e exige escolha explícita. Se não encontrar o app, também encerra sem provisionar. A presença de root não determina qual prefixo contém sua instalação.

Para consultar a ajuda pelo SSH:

```sh
ssh -i "$SSH_KEY" "$TV_USER@$TV_IP" "node - --help" < scripts/provision-native-catalog.cjs
```

Se o manifesto correto estiver no prefixo de desenvolvimento, por exemplo:

```sh
ssh -i "$SSH_KEY" "$TV_USER@$TV_IP" "node - --prefix /var/luna-service2-dev" < scripts/provision-native-catalog.cjs
```

O equivalente no PowerShell é:

```powershell
Get-Content -Raw -LiteralPath .\scripts\provision-native-catalog.cjs |
    ssh -i "$SSH_KEY" "${TV_USER}@${TV_IP}" "node - --prefix /var/luna-service2-dev"
```

Substitua o prefixo pelo outro valor permitido somente quando ele corresponder ao manifesto instalado. Reconhecer o prefixo normal não comprova compatibilidade completa com qualquer instalação Homebrew. A versão atual do provisionador é coberta por testes simulados; não foi aplicada em todas as combinações de instalação e firmware.

O backup administrativo fica em `/var/lib/casa-launcher/permission-backup/`, separado por prefixo. A gravação usa substituição atômica por arquivo; se a aplicação ou recarga LS2 falhar, o script tenta restaurar os metadados anteriores e recarregar LS2. Se informar rollback incompleto, preserve o backup e revise o erro antes de tentar novamente.

Feche e reabra o Casa depois da alteração. O catálogo pode ser consultado sob demanda; a interface não precisa esperar a consulta para aparecer. **Após atualizar ou reinstalar o IPK, pode ser necessário aplicar novamente**, pois o instalador pode recriar o manifesto.

Se o script recusar usuário, manifesto, prefixo ou varredura de serviços, conserve a mensagem de erro e consulte a seção de diagnóstico. Não transforme uma recusa em concessão global de permissões.

## 4. Reverter permissões e desinstalar

Se aplicou o provisionamento opcional, **reverta antes de desinstalar o IPK**. O script precisa identificar o manifesto que ainda está instalado. Use o mesmo prefixo selecionado na aplicação, quando houver seleção explícita.

Em um shell POSIX:

```sh
ssh -i "$SSH_KEY" "$TV_USER@$TV_IP" "node - --restore" < scripts/provision-native-catalog.cjs
```

No PowerShell:

```powershell
Get-Content -Raw -LiteralPath .\scripts\provision-native-catalog.cjs |
    ssh -i "$SSH_KEY" "${TV_USER}@${TV_IP}" "node - --restore"
```

`--restore` remove o provisionamento de catálogo do Casa e atualiza a configuração LS2. Não apaga nem reconfigura outros aplicativos. A reversão não substitui a desinstalação do app.

Se aplicou com um prefixo explícito, inclua-o também na reversão:

```sh
ssh -i "$SSH_KEY" "$TV_USER@$TV_IP" "node - --prefix /var/luna-service2-dev --restore" < scripts/provision-native-catalog.cjs
```

O script preserva permissões que já existiam antes da sua aplicação e mantém o backup administrativo. Se houver arquivos de provisionamento sem backup ativo compatível, ele os conserva e pede revisão em vez de removê-los por suposição.

Para desinstalar pela CLI:

```sh
ares-install --device casa-tv --remove com.soar.tv.launcher
```

Também é possível usar o gerenciador pelo qual você instalou o IPK. Dados locais e favoritos podem ser perdidos na remoção. Como o Casa não modifica Home ou boot, não há hook de inicialização para desfazer.

## Desenvolvimento local e empacotamento

Requisitos: Node.js **22.12+**, npm e Git.

```sh
git clone https://github.com/SmookeyDev/casa-webos-launcher.git
cd casa-webos-launcher
npm ci
npx playwright install chromium
```

`npm ci` usa as versões do lockfile. A CLI webOS, o Playwright e o Sharp são dependências de desenvolvimento; elas não são instaladas na TV pelo app.

Para abrir a prévia:

```sh
npm run dev
```

Acesse [http://127.0.0.1:4187](http://127.0.0.1:4187). O servidor escuta somente o computador local. Apps e HDMI são simulados, e áudio permanece desativado; a prévia não solicita o IP nem as credenciais de uma TV.

Para executar as verificações:

```sh
npm run check
npm run verify
```

As verificações de navegador iniciam a prévia automaticamente quando necessário. Se já houver um servidor do Casa em execução, mantenha-o no endereço esperado. As duas suítes executam 30 cenários sem controlar hardware.

O Chromium instalado pelo Playwright é o navegador padrão. Se quiser testar com Google Chrome já instalado, defina o canal para esse comando:

```sh
CASA_BROWSER_CHANNEL=chrome npm run verify
```

Em PowerShell:

```powershell
$env:CASA_BROWSER_CHANNEL = "chrome"
npm run verify
Remove-Item Env:CASA_BROWSER_CHANNEL
```

Para gerar o pacote:

```sh
npm run package
```

O IPK contém interface, serviço e recursos e é criado em `dist/`. Depois de uma alteração, teste a prévia e reinstale o pacote na TV para validar APIs reais. Um teste que passa no computador não comprova permissões LS2, HDMI, reprodução ou áudio no aparelho.

## Diagnóstico

| Sintoma | O que verificar |
| --- | --- |
| `ares` não encontrado | Instalação da CLI/PATH, ou uso de `npx ares-…` após `npm ci`. |
| Falha de conexão | TV ligada, IP atual, rede alcançável, porta e método de autenticação do fluxo escolhido. |
| Developer Mode recusa a chave | Key Server ativo e passphrase atual da sua própria TV. |
| O app abre, mas faltam aplicativos | O catálogo pode estar no fallback. Root existente e permissão opcional habilitam a descoberta completa somente no ambiente validado. |
| Painel mostra Indisponível | Alguma consulta foi recusada ou não existe nesse firmware; não significa necessariamente falha na interface. |
| Um ícone vira iniciais | O catálogo encontrou o app, mas a imagem não está acessível no jail nem nos recursos empacotados. |
| Nome/estado HDMI não aparece | EIM pode estar indisponível; as três entradas permanecem como fallback com estado desconhecido. |
| Após reinstalar, o catálogo perde recursos | O manifesto pode ter sido recriado. Reaplique o provisionamento opcional somente se já o utilizava. |
| `Execute na TV em uma sessão administrativa root existente` | O provisionamento requer UID 0; não deve ser executado pelo usuário Developer Mode. |
| Manifesto/prefixo não encontrado | Instale o pacote primeiro e confira se o script procura o registro LS2 da instalação correta. |
| Há duas instalações | Use `--prefix /var/luna-service2-dev` ou `--prefix /var/luna-service2`, escolhendo o manifesto correto; não aplique aos dois automaticamente. |
| Backup incompatível ou rollback incompleto | Preserve os arquivos e a mensagem. Revise a instalação correspondente antes de alterar permissões novamente. |
| Serviço recusa chamada de `luna-send` por root | O contrato aceita apenas o chamador `com.soar.tv.launcher`. Valide os métodos pela interface do Casa. |
| Botão Home abre a Home LG | Comportamento esperado: o Casa não assume o botão Home. |
| Reabertura não põe o Casa na frente | Use o IPK atual com `handlesRelaunch:false`; o sistema deve ativar a janela. Não force `true` sem implementar a ativação exigida. |
| Teste não encontra o navegador | Execute `npx playwright install chromium`, ou selecione `CASA_BROWSER_CHANNEL=chrome` com Chrome instalado. |
| Preferências desapareceram | Confira se os dados do app foram limpos, se houve desinstalação ou troca de origem na prévia. |

Para relatar um problema, inclua modelo completo, região, firmware, SDK reportado e método de instalação. Copie o erro, mas remova IPs pessoais, nomes de rede, chaves, senhas e passphrases.

## Referências

- [Developer Mode e sessão de desenvolvimento — LG](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app)
- [CLI e comandos de instalação/remoção — LG](https://webostv.developer.lge.com/develop/tools/cli-dev-guide)
- [Configuração de uma TV já com Homebrew — webOS Homebrew](https://www.webosbrew.org/pages/sdk-configuration)
- [Ativação e ciclo de vida de apps — LG](https://webostv.developer.lge.com/develop/guides/app-lifecycle-management)
