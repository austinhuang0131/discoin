// First prototype of Discoin.
// Perfectly lol
const restify = require('restify');
const fs = require('fs');
const request = require('request');
const randtoken = require('rand-token'); // Receipt
const schedule = require('node-schedule'); // Scheduled cleanup of transaction database
var limits = JSON.parse(fs.readFileSync("./limits.json", "utf8"));
var glimits = JSON.parse(fs.readFileSync("./glimits.json", "utf8"));
var alltrans = JSON.parse(fs.readFileSync("./transactions.json", "utf8"));
var users = JSON.parse(fs.readFileSync("./users.json", "utf8"));
var config = JSON.parse(fs.readFileSync("./config.json","utf8"));
var secret = JSON.parse(fs.readFileSync("./secret.json","utf8"));
const clientsecret = secret.clientsecret;
const webhookurl = secret.webhook;

// Define exchange rate.
// From: 1 Bot currency = ? Discoin
// To: 1 Discoin = ? Bot currency
const rates = secret.tokens;

const server = restify.createServer();
server.use(restify.gzipResponse());
server.use(restify.bodyParser());
server.get('/', function status(req, res, next) {
	res.redirect("https://github.com/Discoin/api", next);
});

server.post('/transaction', function respond(req, res, next) {
	const from = rates.find(f => {return f.token === req.headers.authorization});
	if (from === undefined) {
		res.sendRaw(401, '{"status": "error", "reason": "Unauthorized"}');
		return;
	}
	var transaction === req.body;
	if (!users.verified.includes(transaction.user_id)) {
		res.sendRaw(403, '{"status": "declined", "reason": "User is not verified. Go to '+config.apiUrl+'verify"}');
		return;
	}
	if (isNaN(parseInt(transaction.amount))) {
		res.sendRaw(400, '{"status": "error", "reason": "Invalid amount"}');
		return;
	}
	if (parseInt(transaction.amount) <= 0) {
		res.sendRaw(400, '{"status": "error", "reason": "Invalid amount"}');
		return;
	}
	const rate = rates.find(r => {return r.code === transaction.exchangeTo.toUpperCase()});
	if (rate === undefined) {
		res.sendRaw(400, '{"status": "error", "reason": "Invalid destination currency"}');
		return;
	}
	var limit = limits.find(l => {return l.user === transaction.user_id;});
	if (limit === undefined) {
		limit = {user: transaction.user_id, limits: [{usage: 0, code: rate.code}]}; // If the user hasn't made any transaction today, we need to write limit
	}
	var slimit = limit.limits.find(sl => {return sl.code === rate.code;});
	if (slimit === undefined) {
		slimit = {usage: parseInt(transaction.amount) * from.from, code: rate.code}; // If the user hasn't made any transaction to this currency today, we need to write one too
	}
	else if (slimit.usage + parseInt(transaction.amount) * from.from > rate.limit.daily) {
		var a = slimit.usage + parseInt(transaction.amount) * from.from;
		res.sendRaw(403, '{"status": "declined", "reason" : "Daily Per-User Limit exceeded.", "currency": "'+rate.code+'", "limit": '+rate.limit.daily+', "limitNow": '+a+'}'); // If they exceeded, decline
		return;
	}
	else {
		limits.splice(limits.indexOf(limit), 1); // Remove old limit
		limit.limits.splice(limits.indexOf(slimit), 1); // Remove old code-specific limit from the limit
		slimit.usage += parseInt(transaction.amount) * from.from; // Input new code-specific limit
	}
	limit.limits.push(slimit); // Add it
	if (rate.limit.total !== undefined) {
		var glimit = glimits.find(gl => {return gl.code === rate.code});
		if (glimit === undefined) {
			glimit = {code: rate.code, usage: parseInt(transaction.amount) * from.from};
		}
		else if (glimit.usage + parseInt(transaction.amount) * from.from > rate.limit.total) {
		res.sendRaw(403, '{"status": "declined", "reason" : "Daily Total Limit exceeded.","currency": "'+rate.code+'", "limit": '+rate.limit.total+'}'); // If they exceeded, decline
			return;
		}
		else {
			glimits.splice(glimits.indexOf(glimit), 1);
			glimit.usage += parseInt(transaction.amount) * from.from;
		}
		glimits.push(glimit);
		fs.writeFile("./glimits.json", JSON.stringify(glimits), "utf8");
	}
	limits.push(limit);
	fs.writeFile("./limits.json", JSON.stringify(limits), "utf8");
	var amount = parseInt(transaction.amount) * from.from * rate.to;
	var rid = randtoken.generate(20);
	alltrans.push({user: transaction.user_id, fromtime: Date(), from: from.code, to: transaction.exchangeTo, amount: parseInt(transaction.amount) * from.from, id: rid});
	fs.writeFileSync("./transactions.json", JSON.stringify(alltrans), "utf8");
	var balance = rate.limit.daily - slimit.usage;
	res.sendRaw(200, JSON.stringify({status: "Approved", receipt: rid, limitNow: balance, resultAmount: amount}));
	request.post({url: webhookurl, json: true, body: {content: "```\n["+rid+"] User "+transaction.user_id+", "+transaction.amount+" "+from.code+" => "+amount+" "+rate.code+"\n```"}});
});

server.get('/transaction', function respond(req, res, next) {
	const bot = rates.find(f => {return f.token === req.headers.authorization});
	if (bot === undefined) {
		res.sendRaw(401, '{"status": "error", "reason": "Unauthorized"}');
		return;
	}
	var mytransactions = alltrans.filter(t => {return t.to === bot.code}).filter(mt => {return mt.totime === undefined});
	mytransactions.forEach(mt => {
		mytransactions.splice(mytransactions.indexOf(mt));
		mt.amount *= bot.to;
		mytransactions.push(mt);
	});
	res.sendRaw(200, JSON.stringify(mytransactions));
	mytransactions.forEach(m => {
		var at = alltrans.find(ot => {return ot.id === m.id;});
		alltrans.splice(transactions.indexOf(at), 1);
		at.totime = Date();
		alltrans.push(at);
		fs.writeFileSync("./transactions.json", JSON.stringify(alltrans), "utf8");
	});
});

server.get('/rates', function respond(req, res, next) {
	let info = "Current exchange rates for Discoin follows:\n";
	rates.forEach(i => {info += "\n"+i.name+": 1 "+i.code+" => "+i.from+" Discoin => "+i.from*i.to+" "+i.code;});
	info += "\n\nNote that certain transaction limit may exist. Details will be displayed when a transaction is approved.";
	res.sendRaw(info);
});

server.get('/record', function status(req, res, next) {
	if (req.getQuery().indexOf("code=") === -1) {
		res.redirect("https://discordapp.com/oauth2/authorize?client_id=209891886058438656&scope=identify&response_type=code&redirect_uri=" + config.apiUrl + "record", next);
		return;
	}
	request.post("https://discordapp.com/api/oauth2/token?client_id=209891886058438656&grant_type=authorization_code&code="+req.getQuery().replace("code=", "")+"&redirect_uri=http://discoin-austinhuang.rhcloud.com/record&client_secret="+clientsecret, function (error, response, body) {
		if (error || response.statusCode !== 200) {
			res.sendRaw(response.statusCode, "[ERROR] Cannot connect to Discord!\n1. Did you refresh this page? If so, please go back and re-authorize.\n2. Consult http://status.discordapp.com or try again.");
			return;
		}
		body = JSON.parse(body);
		request({url: 'https://discordapp.com/api/users/@me', headers: {'Authorization': 'Bearer '+body.access_token}}, function (error, response, body) {
			if (error || response.statusCode !== 200) {
				res.sendRaw(response.statusCode, "[ERROR] Cannot connect to Discord!\n1. Did you refresh this page? If so, please go back and re-authorize.\n2. Consult http://status.discordapp.com or try again.");
			}
			else {
				body = JSON.parse(body);
				var mytrans = alltrans.filter(ts => {return ts.user === body.id});
				var records = "Hello "+body.username+"#"+body.discriminator+" ("+body.id+"). Here's your transaction record for this calendar month.\nShould you have any questions, don't hesitate to contact Discoin Operation Office at https://discord.gg/t9kUMsv.\n\n--- LEGEND ---\n* Request Time: The time your origin bot requests the transfer\n* Reception Time: The time your destination bot (should) receive the transfer. If not received by the time given please contact the Operation Office.\n* From/To: Currecy codes.\n* Amount: In Discoin.\n\n| Receipt ID         || Request Time                          || Reception Time                        || From ||  To  || Amount";
				mytrans.forEach(mt => {
					if (mt.totime !== undefined) {
						records += "\n|"+mt.id+"||"+mt.fromtime+"||"+mt.totime+"|| "+mt.from+"  || "+mt.to+"  || "+mt.amount;
					}
					else {
						records += "\n|"+mt.id+"||"+mt.fromtime+"||              UNPROCESSED              || "+mt.from+"  || "+mt.to+"  || "+mt.amount;
					}
				});
				res.sendRaw(records);
			}
		});
	});
});

server.get('/verify', function status(req, res, next) {
	if (req.getQuery().indexOf("code=") === -1) {
                res.redirect("https://github.com/austinhuang0131/Discoin/blob/master/before-using.md", next);
		return;
	}
	request.post("https://discordapp.com/api/oauth2/token?client_id=209891886058438656&grant_type=authorization_code&code="+req.getQuery().replace("code=", "")+"&redirect_uri=" + config.apiUrl + "verify&client_secret="+clientsecret, function (error, response, body) {
		if (error || response.statusCode !== 200) {
			res.sendRaw(response.statusCode, "[ERROR] Cannot connect to Discord!\n1. Did you refresh this page? If so, please go back and re-authorize.\n2. Consult http://status.discordapp.com or try again.");
			return;
		}
		body = JSON.parse(body);
		request({url: 'https://discordapp.com/api/users/@me', headers: {'Authorization': 'Bearer '+body.access_token}}, function (error, response, body) {
			if (error || response.statusCode !== 200) {
				res.sendRaw(response.statusCode, "[ERROR] Cannot connect to Discord!\n1. Did you refresh this page? If so, please go back and re-authorize.\n2. Consult http://status.discordapp.com or try again.");
			}
			else {
				body = JSON.parse(body);
				if (users.blacklist.includes(body.id)) {
					res.sendRaw(403, "[ERROR] You have been blacklisted for using a disposable email address before.\nShould you have any questions, please contact https://discord.gg/t9kUMsv.");
					return;
				}
				else if (body.email === null) {
					res.sendRaw(400, "[ERROR] You don't have an email on your Discord account. Please add one onto your account and come back to this page, or you'll not be able to make any Discoin transactions.");
					return;
				}
				var email = body.email;
				var uid = body.id;
				request("https://raw.githubusercontent.com/wesbos/burner-email-providers/master/emails.txt", function (error, response, body) {
					if (error || response.statusCode !== 200) {
						res.sendRaw(response.statusCode, "[ERROR] Cannot connect to GitHub! Check http://status.github.com.");
						return;
					}
					else if (body.split("\n").indexOf(email.split("@")[1]) > -1) {
						res.sendRaw(403, "[ERROR] Disposable email address DETECTED!\nYour email domain is "+email.split("@")[1]+" which is in our Blacklist.\nShould you have any questions, please contact https://discord.gg/t9kUMsv.");
						users.blacklist.push(uid);
						fs.writeFile("./users.json", JSON.stringify(users), "utf8");
					}
					else {
						res.sendRaw("[Success] You can now make Discoin transactions.");
						users.verified.push(uid);
						fs.writeFile("./users.json", JSON.stringify(users), "utf8");
					}
				});
			}
		});
	});
});

var monthcleanup = schedule.scheduleJob({date: 1, hour: 0, minute: 0, second: 0}, function(){
	pastebin.createPaste(JSON.stringify(alltrans), "Monthly transaction record").then(function (data) {console.log(data);}).fail(function (err) {console.log(err);});
	fs.writeFileSync("./transactions.json", "[]", "utf8");
	alltrans = [];
});
var dailycleanup = schedule.scheduleJob({hour: 0, minute: 0, second: 0}, function(){
	fs.writeFileSync("./limits.json", "[]", "utf8");
	fs.writeFileSync("./glimits.json", "[]", "utf8");
	limits = [];
	glimits = [];
});

server.listen(config.port || 8080, process.ENV.port || "127.0.0.1", function() {
	console.log(`${server.name} listening at ${server.url}`);
});
