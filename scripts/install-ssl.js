//auth
//@url('/${SCRIPT_URL}')
//@req(token)

if (token != "${TOKEN}") {
  return {result: 8, error: "wrong token", response: {result: 8}}
}

if (!session) session = signature;

var envDomain = getParam("domain") || "${ENV_DOMAIN}",
customDomain = getParam("customDomain") || "${CUSTOM_DOMAIN}",
envName = getParam("envName") || "${ENV_NAME}",
masterId = getParam("masterId") || "${MASTER_ID}",
masterIP = getParam("masterIP") || "${MASTER_IP}",
urlLeScript = getParam("urlLeScript") || "${LE_INSTALL}",
urlGenScript = getParam("urlGenScript") || "${LE_GENERATE_SSL}",   
urlUpdateScript = getParam("urlUpdateScript") || "${UPDATE_SSL}",     
group = getParam("group") || "${NODE_GROUP}",
email = getParam("email") || "${USER_EMAIL}",
envAppid = getParam("envAppid") || "${ENV_APPID}",
cronTime = getParam("cronTime") || "${CRON_TIME}",
resp, debug = [];

//multi domain support - any following separator can be used: ' ' or ';' or ',' 
if (customDomain) customDomain = customDomain.split(";").join(" ").split(",").join(" ").replace(/\s+/g, " ").trim().split(" ").join(" -d ");

//download and execute Let's Encrypt package installation script 
var fileName = urlLeScript.split('/').pop().split('?').shift();
var execParams = ' ' + urlLeScript + ' -O /root/' + fileName + ' && chmod +x /root/' + fileName + ' && /root/' + fileName + ' >> /var/log/letsencrypt.log';
resp = jelastic.env.control.ExecCmdById(envName, session, masterId,  toJSON( [ { "command": "wget", "params": execParams } ]), true, "root"); 
debug.push(resp);

//download SSL generation script
fileName = urlGenScript.split('/').pop().split('?').shift();
execParams = ' ' + urlGenScript + ' -O /root/' + fileName + ' && chmod +x /root/' + fileName;
resp = jelastic.env.control.ExecCmdById(envName, session, masterId,  toJSON( [ { "command": "wget", "params": execParams } ]), true, "root"); 
debug.push(resp);

//write configs for SSL generation
execParams = '\"domain=\'' + (customDomain || envDomain) + '\'\nemail=\''+email+'\'\nappid=\''+envAppid+'\'\nappdomain=\''+envDomain+'\'\n\" >  /opt/letsencrypt/settings' 
resp = jelastic.env.control.ExecCmdById(envName, session, masterId,  toJSON( [ { "command": "printf", "params": execParams } ]), true, "root"); 
debug.push(resp);

manageDnat('add');

//execute SSL generation script 
execParams = '/root/' + fileName;
resp = jelastic.env.control.ExecCmdById(envName, session, masterId,  toJSON( [ { "command": "bash", "params": execParams } ]), true, "root"); 
debug.push(resp);

manageDnat('remove');

//checking errors of the SSL generation process 
var out = resp.responses[0].out;
var ind1 = out.indexOf("Reporting to user: The following errors");
if (ind1 != -1){
  var ind2 = out.indexOf("appid =", ind1);
  var error = ind2 == -1 ? out.substring(ind1) : out.substring(ind1, ind2);
  return {
    result: 99,
    error: error,
    response: error,
    debug: debug
  }
}

//download and configure cron job for auto update script 
var autoUpdateUrl = getParam('autoUpdateUrl');
if (autoUpdateUrl) {
  fileName = urlUpdateScript.split('/').pop().split('?').shift();
  execParams = ' ' + urlUpdateScript + ' -O /root/' + fileName + ' && chmod +x /root/' + fileName;
  execParams += ' && crontab -l | grep -v "' + fileName + '" | crontab - && echo \"' + cronTime + ' /root/' + fileName + ' ' + autoUpdateUrl +'\" >> /var/spool/cron/root';
  resp = jelastic.env.control.ExecCmdById(envName, session, masterId,  toJSON( [ { "command": "wget", "params": execParams } ]), true, "root"); 
  debug.push(resp);
}

//read certificates
var cert_key = jelastic.env.file.Read(envName, session, "/tmp/privkey.url", null, null, masterId);
var cert = jelastic.env.file.Read(envName, session, "/tmp/cert.url", null, null, masterId);
var fullchain = jelastic.env.file.Read(envName, session, "/tmp/fullchain.url", null, null, masterId);

if (cert_key.body && fullchain.body && cert.body){
  resp = jelastic.env.binder.BindSSL(envName, session, cert_key.body, cert.body, fullchain.body);
  debug.push(resp);
} else {
  var error = "can't read ssl certificate";
  resp = {
    result: 99, 
    error: error,
    response: error
  }
}

resp.debug = debug;
return resp;

//managing certificate challenge validation by routing all requests to master node with let's encrypt engine   
function manageDnat(action) {
  var dnatParams = 'a | grep -q  ' + masterIP + ' || iptables -t nat ' + (action == 'add' ? '-I' : '-D') + ' PREROUTING -p tcp --dport 443 -j DNAT --to-destination ' + masterIP + ':443';
  resp = jelastic.env.control.ExecCmdByGroup(envName, session, group, toJSON([{ "command": "ip", "params": dnatParams }]), true, false, "root"); 
  debug.push(resp);
}

