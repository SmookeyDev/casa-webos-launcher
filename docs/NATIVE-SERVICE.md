# Integração nativa

O Casa inclui o serviço Node `com.soar.tv.launcher.service` no mesmo IPK do app `com.soar.tv.launcher`. Ele consulta aplicativos e estado da TV e oferece três controles fixos de áudio. O serviço continua no jail normal do webOS, com a identidade de usuário atribuída pelo instalador. Não precisa executar como root.

O provisionador administrativo de catálogo é opcional e separado do serviço. Ele precisa de uma sessão root já disponível para conceder uma permissão LS2 à identidade do serviço. Não instala root, não eleva o processo do serviço e não modifica Home, inicialização ou arquivos de firmware.

## Modos e compatibilidade

| Ambiente | Comportamento |
| --- | --- |
| Navegador no computador | Usa prévias; nenhuma ação controla a TV. |
| IPK pelo Developer Mode | App e serviço regulares. As APIs permitidas pelo firmware funcionam sem provisionar o catálogo privado. Quando a descoberta completa é recusada, o bridge tenta o catálogo local e verifica a presença dos apps. |
| TV com acesso root existente | O provisionador opcional pode habilitar o catálogo completo somente para o serviço. O processo continua no jail. |
| Homebrew Channel ou outro instalador | O provisionador reconhece também o prefixo LS2 não developer, se esse instalador tiver criado o manifesto esperado. Isso não garante compatibilidade completa com qualquer instalador ou firmware. |

A integração foi validada em webOS TV 25, com Node 16.20.2. APIs internas, estrutura de permissões e acesso a arquivos variam entre versões. O provisionador novo é coberto por testes simulados; o caminho não developer não tem validação completa em todas as combinações de Homebrew/firmware. O projeto não é uma publicação no catálogo do Homebrew Channel.

## Interface do serviço

Todos os métodos exigem `message.sender === "com.soar.tv.launcher"`. O manifesto declara seis métodos privados. O serviço não fornece endpoint para executar comandos, encaminhar URIs Luna arbitrárias, lançar apps por parâmetros ou ler caminhos enviados pelo cliente. A abertura de aplicativos fica no bridge web e usa a API de lançamento da plataforma.

| Método | Payload | Resposta |
| --- | --- | --- |
| `getCatalog` | `{}` | `available`, `apps:[{id,title,systemApp,icon?}]`, `partial`, `errors`, `updatedAt` |
| `getTVStatus` | `{}` | `available`, `volume`, `muted`, `soundOutput`, `network`, `capabilities`, `partial`, `errors`, `updatedAt` |
| `volumeUp` | `{}` | Um passo de volume; releitura de `volume` e `muted` |
| `volumeDown` | `{}` | Um passo de volume; releitura de `volume` e `muted` |
| `toggleMute` | `{}` | Lê o estado atual e envia sua inversão; releitura de `volume` e `muted` |
| `watchVolume` | `{subscribe:true}` e chamada de assinatura | Eventos `volume`, `muted`, `updatedAt`, com `subscribed:true` |

Respostas concluídas incluem `returnValue:true`. Campos indisponíveis são `null`; uma falha parcial não é apresentada como sucesso completo. `errors` identifica o componente indisponível. Erros de chamada usam `{returnValue:false,errorCode,errorText}` com mensagens resumidas, sem propagar a resposta nativa integral.

`network` contém somente `{connected,type,internet}`. `type` é `wifi`, `wired` ou `null`. `connected` descreve o enlace local e `internet` o estado de acesso à internet informado pela TV. IP, SSID, identificadores de conta e números de série não são retornados. `capabilities.volume/mute` informa disponibilidade de leitura; o firmware ainda pode recusar uma ação de controle.

Os três controles não aceitam valores arbitrários. Ajustes concorrentes ou separados por menos de 120 ms retornam `BUSY`. Se uma ação funcionar e sua releitura falhar, o serviço retorna sucesso com `partial:true`; ele não repete a ação.

## APIs utilizadas

Todas as URIs abaixo têm o prefixo `luna://`.

| Finalidade | URI / payload |
| --- | --- |
| Catálogo | `com.webos.applicationManager/listApps {}` e `listLaunchPoints {}` |
| Volume pontual | `com.webos.audio/getVolume {}` |
| Eventos de volume | `com.webos.service.audio/master/getVolume {subscribe:true}` |
| Controles | `com.webos.audio/volumeUp {}`, `volumeDown {}`, `setMuted {muted:boolean}` |
| Saída de áudio | `com.webos.service.audio/getSoundOutput {}`; alternativa fixa `com.webos.settingsservice/getSystemSettings {category:"sound",keys:["soundOutput"]}` |
| Rede | `com.webos.service.connectionmanager/getstatus {}`; alternativa fixa `com.palm.connectionmanager/getStatus {}` |

O watch usa `master/getVolume` porque, no firmware validado, `com.webos.audio/getVolume {subscribe:true}` entregava apenas a resposta inicial. A API de master envia alterações em `volumeStatus` e pode omitir o campo `subscribed`; o serviço normaliza esses eventos. Um `subscribed:false` explícito encerra a assinatura.

O ciclo de cancelamento usa os mecanismos de `webos-service`: callback de cancelamento de `register`, identificação por `message.uniqueToken`, `message.cancel()` para encerrar o cliente e `Subscription.cancel()` para encerrar a chamada nativa. O bridge cancela ao fechar o painel ou ocultar o app.

## Permissão opcional do catálogo

O grupo LS2 `applications.internal` permite acessar o inventário privado no firmware validado. Ele é definido pela plataforma e pode abranger mais operações que as duas consultas de catálogo usadas pelo Casa. Portanto, conceder o grupo amplia o acesso ao barramento do serviço; não é uma permissão limitada a duas URIs. A proteção da interface depende também da revisão dos métodos fixos e da validação do chamador.

O provisionador acrescenta `public` e `applications.internal` somente à identidade `com.soar.tv.launcher.service`. Ele não adiciona o grupo privado à identidade do app web, não muda `trustLevel` e não cria permissões wildcard. Permissões preexistentes de outros clientes são preservadas.

### Selecionar a instalação

Instale o IPK antes de provisionar. Feche o Casa e deixe o serviço encerrar normalmente antes de alterar suas permissões. Execute o script na TV em uma sessão administrativa existente, depois de copiá-lo para um local temporário, por exemplo:

```sh
node /tmp/provision-native-catalog.cjs
```

O script procura o manifesto `com.soar.tv.launcher.json` somente em:

- `/var/luna-service2-dev/manifests.d/`;
- `/var/luna-service2/manifests.d/`.

Se encontrar exatamente um, usa esse prefixo. Se encontrar ambos, encerra sem alterar arquivos e pede uma escolha explícita. A opção aceita somente os dois prefixos fixos:

```sh
node /tmp/provision-native-catalog.cjs --prefix /var/luna-service2-dev
node /tmp/provision-native-catalog.cjs --prefix /var/luna-service2
```

Use apenas o comando correspondente à instalação desejada. O prefixo descreve os metadados LS2 criados pelo instalador; não seleciona uma versão do webOS e não migra apps entre instalações. Não é possível fornecer um caminho arbitrário de manifesto ou grant.

Depois, reabra o Casa e confira `getCatalog` pelo contexto real do app. Uma chamada root com `luna-send` não prova que o serviço regular recebeu a permissão. Se o firmware continuar recusando a operação, mantenha o fallback e registre a limitação; o projeto não recomenda elevar o serviço a root.

### Backup, atualizações e restauração

O provisionador guarda o manifesto original, o conteúdo e modo do arquivo de grant preexistente e a presença original de sua referência. Os estados são separados por prefixo:

- `/var/lib/casa-launcher/permission-backup/developer.json`;
- `/var/lib/casa-launcher/permission-backup/system.json`.

A pasta usa modo `0700` e os backups `0600`. Reaplicações preservam o estado inicial do provisionamento ativo. A instalação de um IPK pode recriar o manifesto; nesse caso reaplique o provisionador no mesmo prefixo e confirme o resultado no app.

Para desfazer o que esta versão do provisionador adicionou:

```sh
node /tmp/provision-native-catalog.cjs --restore --prefix /var/luna-service2-dev
```

Use `/var/luna-service2` se essa for a instalação escolhida. A restauração remove somente a referência que não existia antes e os grupos acrescentados pelo provisionador. Arquivos, grupos e referências preexistentes são preservados. Quando ninguém editou o grant após a aplicação, o conteúdo e modo originais são repostos; quando há edições posteriores, a remoção é seletiva e preserva outros grupos/clientes. O manifesto inteiro de uma instalação nova não é substituído por uma cópia antiga. Repetir a restauração concluída não modifica os arquivos novamente.

Sem backup ativo reconhecido, a ferramenta recusa remover um grant existente. Backups e grants de versões antigas não são migrados automaticamente. Se a permissão privada já existia antes do primeiro uso desta versão, ela é tratada como preexistente e permanece após `--restore`.

As escritas usam arquivo temporário exclusivo, `fsync` e renomeação no mesmo diretório. Se uma escrita ou `ls-control scan-services` falhar, o script tenta restaurar os três arquivos ao estado imediatamente anterior e recarregar LS2. Se essa recuperação também falhar, informa rollback incompleto e exige revisão administrativa. Isso não constitui uma transação única resistente a uma queda de energia entre arquivos. Execute uma operação por vez e preserve os backups até confirmar o resultado.

## Catálogo e ícones

O catálogo combina os dois inventários nativos e aplica o filtro de `services/com.soar.tv.launcher.service/catalog-filter.js`. Itens ocultos, serviços, placeholders `stub`, componentes de publicidade, desenvolvimento, protetores de tela e demonstração de loja não aparecem, assim como o próprio Casa. Os componentes esportivos LG excluídos são somente os IDs exatos `sportsalarm`, `com.webos.service.sportsalert` e `com.webos.app.sportsteamsettings`; nomes contendo “sport” não são um critério de exclusão.

Apps comuns visíveis, incluindo serviços de música, esportes, jogos e assistentes, são elegíveis. Não há bloqueio por preferência pessoal a Apple Music, Mercado Play, 8Ball, Alexa ou Copilot. Apps de sistema continuam sujeitos à lista explícita de utilitários — TV ao vivo, navegador, mídia, Apps, Hub Inicial, câmera e Homebrew. Esses utilitários podem aparecer mesmo com `visible:false`; `hidden:true` continua sendo respeitado. Os filtros só controlam o catálogo e não desinstalam nem desativam apps da TV.

Ícones externos só são lidos a partir dos caminhos do inventário, dentro da pasta do próprio app e das raízes permitidas. O arquivo real precisa ser regular, permanecer na raiz permitida e ter no máximo 128 KiB. O serviço usa `O_NOFOLLOW` e confere assinaturas binárias PNG/JPEG/WebP; URLs remotas e SVG não são aceitos.

Quando o jail bloqueia o recurso de outro app, o fallback é exclusivamente `icons/<appId>.png` dentro da pasta real do próprio serviço. O ID precisa estar no inventário filtrado. A pasta `icons` não pode redirecionar para outro local e o arquivo real precisa corresponder exatamente ao ID e ser PNG. Esses recursos entram no IPK durante o desenvolvimento. Um app sem ícone empacotado recebe `icon` ausente para a interface mostrar iniciais. Não há helper root nem download de ícones em runtime.

## Limites de execução

- Até 96 apps no catálogo, dois leitores de ícones, até 1,5 MiB de imagens por resposta e prazo de leitura de 1,8 s.
- Cache de catálogo de 30 s e de status de 1 s; consultas simultâneas compartilham o trabalho pendente.
- Chamadas Luna pontuais com timeout de 1,8 s e cancelamento na primeira resposta. Rede e saída de áudio têm uma alternativa fixa, portanto uma consulta de status pode levar aproximadamente 3,6 s em falha.
- Até dois clientes de `watchVolume`, com timeout inicial de 2 s. Cancelamento, erro ou encerramento nativo libera a assinatura.
- Sem polling periódico, reconexão automática, servidor HTTP, tarefa de boot ou keepalive independente. A plataforma pode encerrar o serviço quando não houver cliente ativo.

## Build e verificações

`npm run package` inclui o app e o serviço no IPK. O runtime `webos-service` é fornecido pela TV; não é necessário instalar uma dependência npm na TV.

O provisionador tem testes sem SSH, sem acesso à TV e sem escrita real no filesystem:

```sh
node scripts/provision-native-catalog.test.cjs
node --check scripts/provision-native-catalog.cjs
node --check services/com.soar.tv.launcher.service/service.js
```

Eles cobrem seleção de prefixo, permissões preexistentes, reaplicação, reinstalação, restauração seletiva, escrita atômica e rollback. Um teste adicional inicia um processo Node real com `node - --help`, fornecendo o código por stdin, para validar a entrada usada em comandos SSH por pipe; ele não executa o provisionamento. Não substituem a verificação no firmware de destino. Testes do app devem verificar catálogo, áudio, eventos de volume e encerramento do serviço a partir da identidade do Casa.

Referências oficiais: [serviços JavaScript](https://webostv.developer.lge.com/develop/guides/js-service-usage), [services.json](https://webostv.developer.lge.com/develop/references/services-json), [webos-service](https://webostv.developer.lge.com/develop/references/webos-service-reference), [áudio](https://webostv.developer.lge.com/develop/references/audio). APIs internas e grupos privados precisam ser verificados no firmware utilizado.
