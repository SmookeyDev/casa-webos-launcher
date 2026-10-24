# Integração webOS

O módulo `app/js/webos-bridge.js` expõe `window.TVBridge`. Não contém endereço da TV, chave SSH, credenciais ou acesso remoto pelo navegador. Não exige o Homebrew Channel para abrir aplicativos.

## Métodos

- `isTV`: detecta contexto webOS/SmartTV; nesse contexto uma ponte ausente gera erro e nunca simula sucesso.
- `listApps()`: primeiro consulta `com.soar.tv.launcher.service/getCatalog`. Catálogo completo usa origem `native`; parcial usa `native-partial` e preserva itens do cache. Se o serviço estiver indisponível, tenta a lista normal e depois `getAppLoadStatus` sobre o catálogo auditado, até quatro chamadas simultâneas. Um fallback limitado não apaga favoritos externos ao catálogo embutido.
- `listInputs()`: consulta `com.webos.service.eim/getAllInputStatus`. Retorna HDMI com nome, appId e estado real. Se houver falha, usa `window.LauncherInputs` ou as três HDMI conhecidas do modelo; `connected:null` significa estado desconhecido, não desconectado.
- `launchApp(id)`, `openInput(input)`, `openSettings()` e `openLiveTV()`: usam exclusivamente `applicationManager/launch`. Negação e falha são rejeições da Promise; a UI mostra o erro. HDMI aceita somente as três portas do modelo.
- `getTVStatus()`: consulta o serviço local e retorna campos sanitizados de volume, mudo, saída e rede. Não expõe SSID/IP. Falha resulta em `available:false`, sem números fictícios.
- `controlAudio(method)`: aceita exclusivamente `volumeUp`, `volumeDown` e `toggleMute`. O serviço valida o chamador e parâmetros.
- `watchVolume(callback)`: assinatura de volume/mudo durante a central; retorna função de cancelamento. A UI cancela ao fechar/esconder e refaz ao retornar. Erro encerra sem reconexão automática ou polling.
- `exit()`: usa a navegação/saída nativa disponível.
- `getStatus()`: origem dos inventários e erros de descoberta. O erro de listagem privada pode ser esperado num app comum.

No navegador, os inventários são prévias do catálogo e as ações retornam `{preview:true,id,title}`. Nenhuma chamada da prévia controla a TV.

## Evidência e limites

Em 23/10/2026, consultas somente leitura pelo barramento público desta LG 43UR7800PSA / SDK 10.3.2 confirmaram:

- `applicationManager/listApps` negado;
- `applicationManager/getAppLoadStatus` com `{appId:"netflix"}` respondeu `exist:true`;
- `eim/getAllInputStatus` retornou HDMI_1, HDMI_2 e HDMI_3, então desconectadas.

Na versão 0.2.0, o IPK foi instalado e as consultas foram repetidas no contexto real do Casa: origem `native`, 16 apps e ícones, rede Wi-Fi/internet, volume e alto-falantes internos. O serviço roda no jail normal, sem identidade root. O grupo `applications.internal` foi concedido exclusivamente ao serviço para leitura do catálogo; o app web permanece sem acesso privado direto. Não há `trustLevel:trusted`, ponte para `hbchannel.service/exec`, alteração da Home ou autostart. [Contrato nativo](native-service.md).

Permissão de lançamento a considerar no `appinfo.json`: `applications.launcher`. As permissões efetivas são decididas pelo firmware; o inventário completo e a descoberta EIM podem continuar limitados.

Fontes primárias:

- [LG Application Manager: launch e getAppLoadStatus](https://webostv.developer.lge.com/develop/references/application-manager)
- [LG webOS API: platformBack](https://webostv.developer.lge.com/develop/references/webostvjs-webos)

O módulo conserva as referências nativas e cancela as requisições ao concluir ou expirar (até 9 s para catálogo). Mantém somente a assinatura de áudio enquanto a central está aberta e visível. Catálogo/HDMI são atualizados na inicialização e no retorno, com coalescimento e intervalo mínimo de 10 s entre atualizações de retorno. Não há polling em segundo plano.
