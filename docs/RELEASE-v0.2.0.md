# Casa 0.2.0

Primeiro pacote público do Casa: launcher independente para LG webOS TV, com visual limpo e navegação pelo controle remoto.

## Baixar e instalar

- Baixe **com.soar.tv.launcher_0.2.0_all.ipk** nos arquivos desta release.
- Consulte o [guia de instalação](https://github.com/SmookeyDev/casa-webos-launcher/blob/main/docs/INSTALLATION.md) para o fluxo Developer Mode ou uma TV já com root.
- O arquivo **SHA256SUMS** permite conferir a integridade do download.

O Casa aparece como aplicativo. A Home LG e o botão Home permanecem no comportamento original da TV.

## Recursos

- Seis favoritos organizáveis, catálogo paginado e recentes dos apps abertos pelo Casa.
- Entradas HDMI com informações da TV.
- Central de controle com volume, mudo, rede, saída de som e atalhos nativos.
- Preferências e foco salvos localmente; movimento reduzido por padrão na TV.

## Compatibilidade e validação

Integração completa comprovada na **LG 43UR7800PSA**, **webOS TV 25 / SDK 10.3.2**, firmware **33.31.75**. Outros modelos e firmwares ainda precisam de validação.

A descoberta completa usa uma permissão privada opcional concedida somente ao serviço local. O serviço continua no jail normal, sem identidade root. O projeto não obtém root nem instala autostart. APIs indisponíveis usam os fallbacks descritos no README.

Foram executadas 30 verificações de navegador, 15 testes do provisionador e 12 testes do filtro de catálogo, além das verificações de integração em hardware documentadas. A prévia do computador não controla uma TV.

Novos aplicativos podem aparecer com iniciais quando o ícone não é acessível. O suporte a HDMI nesta versão considera as três portas do modelo validado.
