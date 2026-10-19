// @version 1.3
// Read-only q003 quest and scene metadata report.
// Reads three resources from mounted game archives and writes only a compact report to WolvenKit's log.
// It does not export, save, edit, or package vanilla resources.

import * as Logger from 'Logger.wscript';

const REPORT_MARKER = 'WOLVENKIT_Q003_REPORT_V1:';
const RESOURCE_PATHS = [
    'base\\quest\\main_quests\\prologue\\q003\\q003.questphase',
    'base\\quest\\main_quests\\prologue\\q003\\phases\\q003_royce_deal.questphase',
    'base\\quest\\main_quests\\prologue\\q003\\scenes\\q003_03_deal.scene'
];

const INTERESTING_FIELDS = new Set([
    'debugstring', 'factname', 'setexactvalue', 'value', 'comparisontype',
    'sceneFile', 'sceneLocation', 'phaseResource', 'reward', 'rewardName',
    'saveLock', 'endGameSave', 'ignoreSaveLocks', 'pointOfNoReturn',
    'retryOnFailure', 'operation', 'factOperation', 'factValue', 'name',
    'exitName', 'outputName', 'socketName'
].map(value => value.toLowerCase()));

const GENERIC_SOCKET_LABELS = new Set(['in', 'out', 'input', 'output', 'cut', 'cutdestination']);

function readEndpoint(value) {
    let endpoint = value;
    if (typeof endpoint === 'string') {
        try { endpoint = JSON.parse(endpoint); } catch (e) { return { handleId: null, handleRefId: null, nodeId: null, socketName: null, socketType: null }; }
    }
    const rawData = prop(endpoint, 'Data');
    const data = unwrap(rawData === undefined ? endpoint : rawData);
    return {
        handleId: compact(prop(endpoint, 'HandleId')),
        handleRefId: compact(prop(endpoint, 'HandleRefId')),
        nodeId: compact(prop(data, 'id')),
        socketName: compact(prop(data, 'name')) || compact(prop(endpoint, 'name')),
        socketType: compact(prop(data, 'type')) || compact(prop(endpoint, 'type'))
    };
}

function prop(obj, name) {
    if (obj === null || obj === undefined || typeof obj !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, name)) return obj[name];
    const target = name.toLowerCase();
    for (const key of Object.keys(obj)) {
        if (key.toLowerCase() === target) return obj[key];
    }
    return undefined;
}

function unwrap(value) {
    let current = value;
    for (let i = 0; i < 6; i++) {
        if (current === null || current === undefined || typeof current !== 'object' || Array.isArray(current)) break;
        let next = prop(current, 'Chunk');
        if (next === undefined) next = prop(current, 'Data');
        if (next === undefined) next = prop(current, '$value');
        if (next === undefined || next === current || typeof next !== 'object') break;
        current = next;
    }
    return current;
}

function compact(value, limit = 240) {
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 12).map(item => compact(item, limit));
    const typedValue = prop(value, '$value');
    if (typedValue !== undefined && (prop(value, '$type') !== undefined || prop(value, '$storage') !== undefined)) {
        return compact(typedValue, limit);
    }
    let text;
    try { text = JSON.stringify(value); } catch (e) { text = String(value); }
    return text.length > limit ? text.slice(0, limit) + '…' : text;
}

function typeName(value) {
    const type = prop(unwrap(value), '$type');
    return type === undefined ? '' : String(compact(type));
}

function readSelectedFields(node) {
    const result = [];
    const visited = new Set();
    function walk(value, fieldPath, depth) {
        if (depth > 12 || value === null || value === undefined || typeof value !== 'object') return;
        if (Array.isArray(value)) {
            value.forEach((item, index) => walk(item, fieldPath + '[' + index + ']', depth + 1));
            return;
        }
        if (visited.has(value)) return;
        visited.add(value);
        for (const key of Object.keys(value)) {
            const nextPath = fieldPath ? fieldPath + '.' + key : key;
            if (INTERESTING_FIELDS.has(key.toLowerCase())) result.push({ field: nextPath, value: compact(value[key]) });
            walk(value[key], nextPath, depth + 1);
        }
    }
    walk(node, '', 0);
    return result;
}

function readSockets(node) {
    const rawSockets = prop(unwrap(node), 'sockets');
    if (!Array.isArray(rawSockets)) return [];
    return rawSockets.map((rawSocket, index) => {
        const socket = unwrap(rawSocket);
        const rawConnections = prop(socket, 'connections');
        const connections = Array.isArray(rawConnections) ? rawConnections.map(rawConnection => {
            const connection = unwrap(rawConnection);
            return {
                source: readEndpoint(prop(connection, 'source')),
                destination: readEndpoint(prop(connection, 'destination'))
            };
        }) : [];
        return {
            index: index,
            handleId: compact(prop(rawSocket, 'HandleId')),
            handleRefId: compact(prop(rawSocket, 'HandleRefId')),
            name: compact(prop(socket, 'name')),
            type: compact(prop(socket, 'type')),
            connections: connections
        };
    });
}

function collectNodes(value, jsonPath, found, depth) {
    if (depth > 80 || value === null || value === undefined || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectNodes(item, jsonPath + '[' + index + ']', found, depth + 1));
        return;
    }
    const node = unwrap(value);
    const type = typeName(node);
    const id = prop(node, 'id');
    const sockets = prop(node, 'sockets');
    if (/(?:NodeDefinition|Node)$/i.test(type) && (id !== undefined || Array.isArray(sockets))) {
        found.push({
            id: compact(id),
            type: type,
            fields: readSelectedFields(node),
            sockets: readSockets(node),
            jsonPath: jsonPath
        });
    }
    for (const key of Object.keys(node)) {
        if (key === '$type') continue;
        collectNodes(node[key], jsonPath ? jsonPath + '.' + key : key, found, depth + 1);
    }
}

function collectGraphConnectionDefinitions(value, found, depth) {
    if (depth > 120 || value === null || value === undefined) return;
    if (typeof value === 'string') {
        const serialized = value.trim();
        if (serialized.startsWith('{') || serialized.startsWith('[')) {
            try {
                collectGraphConnectionDefinitions(JSON.parse(serialized), found, depth + 1);
            } catch (e) {
                // Ignore strings that look like JSON but are not parseable; unresolved wires stay explicit.
            }
        }
        return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach(item => collectGraphConnectionDefinitions(item, found, depth + 1));
        return;
    }
    const data = unwrap(value);
    if (/^graphGraphConnectionDefinition$/i.test(typeName(data))) {
        found.push({
            source: readEndpoint(prop(data, 'source')),
            destination: readEndpoint(prop(data, 'destination'))
        });
    }
    for (const key of Object.keys(value)) {
        collectGraphConnectionDefinitions(value[key], found, depth + 1);
    }
}

function isDirectGraphNode(resourcePath, node) {
    if (/\.scene$/i.test(resourcePath)) {
        return /^\$\.RootChunk\.sceneGraph\.graph\[\d+\]\.questNode$/.test(node.jsonPath);
    }
    return /^\$\.RootChunk\.graph\.nodes\[\d+\]$/.test(node.jsonPath);
}

function nodeRecord(resourcePath, node) {
    return { resource: resourcePath, id: node.id, type: node.type, fields: node.fields, sockets: node.sockets };
}

function compactNodeRecord(resourcePath, node) {
    return {
        resource: resourcePath,
        id: node.id,
        type: node.type,
        fields: node.fields,
        sockets: node.sockets.map(socket => ({
            index: socket.index,
            handleId: socket.handleId,
            handleRefId: socket.handleRefId,
            name: socket.name,
            type: socket.type
        }))
    };
}

function normalizedId(value) {
    if (value === null || value === undefined || typeof value === 'object') return '';
    return String(value).trim().toLowerCase();
}

function normalizedPath(value) {
    let result = String(value).toLowerCase().split(String.fromCharCode(92)).join('/');
    while (result.includes('//')) result = result.split('//').join('/');
    return result;
}

function graphEdges(nodes, connectionDefinitions) {
    const byId = new Map();
    const socketOwner = new Map();
    const socketByHandle = new Map();
    for (const node of nodes) {
        const key = normalizedId(node.id);
        if (key) byId.set(key, node);
        for (const socket of node.sockets) {
            for (const ref of [socket.handleId, socket.handleRefId].map(normalizedId).filter(Boolean)) {
                socketOwner.set(ref, node);
                socketByHandle.set(ref, socket);
            }
        }
    }
    function resolve(endpoint) {
        if (!endpoint) return null;
        const refs = [endpoint.nodeId, endpoint.handleRefId, endpoint.handleId].map(normalizedId).filter(Boolean);
        for (const ref of refs) {
            const directNode = byId.get(ref);
            if (directNode) return { node: directNode, socket: null };
            const socketNode = socketOwner.get(ref);
            if (socketNode) return { node: socketNode, socket: socketByHandle.get(ref) || null };
        }
        return null;
    }
    const records = [];
    for (const node of nodes) {
        for (const socket of node.sockets) {
            for (const connection of socket.connections) {
                records.push({
                    source: connection.source,
                    destination: connection.destination,
                    currentNode: node,
                    currentSocket: socket
                });
            }
        }
    }
    for (const connection of connectionDefinitions || []) {
        records.push({ source: connection.source, destination: connection.destination });
    }
    const edges = [];
    const seen = new Set();
    for (const connection of records) {
        const fromResolution = resolve(connection.source);
        const toResolution = resolve(connection.destination);
        let from = fromResolution ? fromResolution.node : null;
        let to = toResolution ? toResolution.node : null;
        const currentNode = connection.currentNode;
        const currentSocket = connection.currentSocket;
        const direction = currentSocket && typeof currentSocket.type === 'string' ? currentSocket.type.toLowerCase() : '';
        if (!from && currentNode && direction === 'output') from = currentNode;
        if (!to && currentNode && direction === 'input') to = currentNode;
        const fromSocket = connection.source && connection.source.socketName ||
            (fromResolution && fromResolution.socket && fromResolution.socket.name) ||
            (from === currentNode && currentSocket ? currentSocket.name : null);
        const toSocket = connection.destination && connection.destination.socketName ||
            (toResolution && toResolution.socket && toResolution.socket.name) ||
            (to === currentNode && currentSocket ? currentSocket.name : null);
        const edgeKey = [from ? normalizedId(from.id) : '', fromSocket || '', to ? normalizedId(to.id) : '', toSocket || '',
            normalizedId(connection.source && connection.source.handleRefId),
            normalizedId(connection.destination && connection.destination.handleRefId)].join('|');
        if (seen.has(edgeKey)) continue;
        seen.add(edgeKey);
        edges.push({
            fromNodeId: from ? from.id : null,
            fromNodeType: from ? from.type : null,
            fromSocket: fromSocket,
            toNodeId: to ? to.id : null,
            toNodeType: to ? to.type : null,
            toSocket: toSocket,
            sourceHandleId: connection.source && connection.source.handleId,
            sourceHandleRefId: connection.source && connection.source.handleRefId,
            destinationHandleId: connection.destination && connection.destination.handleId,
            destinationHandleRefId: connection.destination && connection.destination.handleRefId,
            resolved: !!from && !!to
        });
    }
    return { edges: edges, byId: byId, socketOwner: socketOwner };
}

function factOperation(node) {
    const flattened = node.fields.map(field => ({
        path: String(field.field).toLowerCase(),
        value: field.value
    }));
    const hasFactName = flattened.some(field => /factname|factid|factkey/.test(field.path));
    const writeField = flattened.find(field => /setexactvalue|factoperation|operation/.test(field.path) &&
        /set|write|increment|decrement|add|remove/i.test(String(field.value)));
    const hasSetExactValue = flattened.some(field => /setexactvalue/.test(field.path));
    const checkField = flattened.some(field => /comparisontype|comparison|check|condition/.test(field.path));
    const isFactNode = /fact/i.test(node.type) || hasFactName;
    if (!isFactNode) return null;
    let classification = 'fact-node';
    if (hasSetExactValue || writeField) classification = 'write';
    else if (checkField) classification = 'check';
    return { classification: classification, node: node };
}

function labelsForExit(node, incomingEdges) {
    const labels = [];
    for (const field of node.fields) {
        if (/debugstring|exitname|outputname|socketname|(^|\.)name$/i.test(field.field) &&
            typeof field.value === 'string' && field.value.trim()) labels.push(field.value.trim());
    }
    for (const socket of node.sockets) {
        if (typeof socket.name === 'string' && socket.name.trim()) labels.push(socket.name.trim());
    }
    for (const edge of incomingEdges) {
        if (typeof edge.fromSocket === 'string' && edge.fromSocket.trim()) labels.push(edge.fromSocket.trim());
    }
    return Array.from(new Set(labels));
}

function isUsefulLabel(value) {
    return typeof value === 'string' && value.trim() && !GENERIC_SOCKET_LABELS.has(value.trim().toLowerCase());
}

function traceFactWrites(startNodeId, edges, byId, maxDepth = 60) {
    const outgoing = new Map();
    for (const edge of edges) {
        if (!edge.resolved) continue;
        const key = normalizedId(edge.fromNodeId);
        if (!outgoing.has(key)) outgoing.set(key, []);
        outgoing.get(key).push(edge);
    }
    const queue = [{ id: normalizedId(startNodeId), nodes: [], connections: [], seen: new Set() }];
    const paths = [];
    while (queue.length && paths.length < 20) {
        const current = queue.shift();
        if (current.nodes.length > maxDepth || current.seen.has(current.id)) continue;
        const node = byId.get(current.id);
        if (!node) continue;
        const fact = factOperation(node);
        const nodePath = current.nodes.concat([{ nodeId: node.id, type: node.type }]);
        if (fact && fact.classification === 'write') {
            paths.push({ nodes: nodePath, connections: current.connections, factFields: node.fields });
            continue;
        }
        const nextSeen = new Set(current.seen);
        nextSeen.add(current.id);
        for (const edge of outgoing.get(current.id) || []) {
            queue.push({
                id: normalizedId(edge.toNodeId),
                nodes: nodePath,
                connections: current.connections.concat([{
                    fromNodeId: edge.fromNodeId,
                    fromSocket: edge.fromSocket,
                    toNodeId: edge.toNodeId,
                    toSocket: edge.toSocket
                }]),
                seen: nextSeen
            });
        }
    }
    return paths;
}

function buildExitTraces(phaseNodes, phaseGraph, scenePath) {
    const sceneReferenceNodes = phaseNodes.filter(node => {
        if (!/questSceneNodeDefinition/i.test(node.type)) return false;
        const fields = node.fields.filter(field => /scenefile/i.test(field.field));
        return fields.some(field => normalizedPath(field.value).includes(normalizedPath(scenePath)));
    });
    const exits = [];
    const traces = [];
    for (const sceneNode of sceneReferenceNodes) {
        const outputSockets = sceneNode.sockets.filter(socket =>
            typeof socket.type === 'string' && socket.type.toLowerCase() === 'output');
        for (const socket of outputSockets) {
            const socketName = typeof socket.name === 'string' ? socket.name : '';
            const startEdges = phaseGraph.edges.filter(edge => edge.resolved &&
                normalizedId(edge.fromNodeId) === normalizedId(sceneNode.id) && edge.fromSocket === socketName);
            exits.push({
                nodeId: sceneNode.id,
                nodeType: sceneNode.type,
                sceneResource: scenePath,
                exitSocket: socketName,
                socketIndex: socket.index,
                connections: startEdges.map(edge => ({
                    fromNodeId: edge.fromNodeId,
                    fromSocket: edge.fromSocket,
                    toNodeId: edge.toNodeId,
                    toNodeType: edge.toNodeType,
                    toSocket: edge.toSocket
                }))
            });
            const factWritePaths = [];
            for (const edge of startEdges) {
                const paths = traceFactWrites(edge.toNodeId, phaseGraph.edges, phaseGraph.byId);
                for (const result of paths) {
                    result.connections.unshift({
                        fromNodeId: edge.fromNodeId,
                        fromSocket: edge.fromSocket,
                        toNodeId: edge.toNodeId,
                        toSocket: edge.toSocket
                    });
                    factWritePaths.push(result);
                }
            }
            traces.push({
                sceneNodeId: sceneNode.id,
                sceneResource: scenePath,
                exitSocket: socketName,
                factWritePaths: factWritePaths.slice(0, 20),
                status: factWritePaths.length ? 'fact write path resolved' : 'no resolvable downstream fact write path'
            });
        }
    }
    return { exits: exits, traces: traces, sceneNodeIds: sceneReferenceNodes.map(node => node.id) };
}

const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    wolvenKitVersion: String(wkit.ProgramVersion()),
    resources: [],
    nodeCount: 0,
    reportedNodeCount: 0,
    nodes: [],
    connectionCount: 0,
    reportedConnectionCount: 0,
    connections: [],
    factOperations: [],
    sceneExits: [],
    exitToFactWriteTraces: [],
    unresolvedConnectionCount: 0,
    warnings: []
};

const nodesByResource = {};
const connectionDefinitionsByResource = {};
for (const resourcePath of RESOURCE_PATHS) {
    try {
        const jsonText = wkit.GetFileFromArchive(resourcePath, OpenAs.Json);
        if (jsonText === null || jsonText === undefined) {
            report.resources.push({ resource: resourcePath, status: 'not found in mounted archives', directGraphNodeCount: 0 });
            report.warnings.push('Resource not found in mounted archives: ' + resourcePath);
            continue;
        }
        const parsed = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
        const discovered = [];
        collectNodes(parsed, '$', discovered, 0);
        const connectionDefinitions = [];
        collectGraphConnectionDefinitions(parsed, connectionDefinitions, 0);
        const directNodes = discovered.filter(node => isDirectGraphNode(resourcePath, node));
        nodesByResource[resourcePath] = directNodes;
        connectionDefinitionsByResource[resourcePath] = connectionDefinitions;
        report.resources.push({ resource: resourcePath, status: 'read in memory', directGraphNodeCount: directNodes.length });
    } catch (e) {
        nodesByResource[resourcePath] = [];
        connectionDefinitionsByResource[resourcePath] = [];
        report.resources.push({ resource: resourcePath, status: 'read or parse failed', directGraphNodeCount: 0, error: String(e) });
        report.warnings.push('Could not read ' + resourcePath + ': ' + String(e));
    }
}

const mainPath = RESOURCE_PATHS[0];
const phasePath = RESOURCE_PATHS[1];
const scenePath = RESOURCE_PATHS[2];
const mainNodes = nodesByResource[mainPath] || [];
const phaseNodes = nodesByResource[phasePath] || [];
const sceneNodes = nodesByResource[scenePath] || [];
const mainGraph = graphEdges(mainNodes, connectionDefinitionsByResource[mainPath]);
const phaseGraph = graphEdges(phaseNodes, connectionDefinitionsByResource[phasePath]);
const sceneGraph = graphEdges(sceneNodes, connectionDefinitionsByResource[scenePath]);

const allNodes = mainNodes.map(node => compactNodeRecord(mainPath, node))
    .concat(phaseNodes.map(node => compactNodeRecord(phasePath, node)))
    .concat(sceneNodes.map(node => compactNodeRecord(scenePath, node)));
report.nodeCount = allNodes.length;
report.nodes = allNodes.slice(0, 1200);
report.reportedNodeCount = report.nodes.length;
if (report.nodeCount > report.reportedNodeCount) report.warnings.push('Node list was capped at ' + report.reportedNodeCount + ' of ' + report.nodeCount + ' nodes.');

const allConnections = mainGraph.edges.map(edge => Object.assign({ resource: mainPath }, edge))
    .concat(phaseGraph.edges.map(edge => Object.assign({ resource: phasePath }, edge)))
    .concat(sceneGraph.edges.map(edge => Object.assign({ resource: scenePath }, edge)));
report.connectionCount = allConnections.length;
report.connections = allConnections.slice(0, 1500);
report.reportedConnectionCount = report.connections.length;
if (report.connectionCount > report.reportedConnectionCount) report.warnings.push('Connection list was capped at ' + report.reportedConnectionCount + ' of ' + report.connectionCount + ' wires.');

for (const [resourcePath, nodes] of [[mainPath, mainNodes], [phasePath, phaseNodes], [scenePath, sceneNodes]]) {
    for (const node of nodes) {
        const fact = factOperation(node);
        if (fact) report.factOperations.push(Object.assign({ resource: resourcePath, classification: fact.classification }, nodeRecord(resourcePath, node)));
    }
}
report.factOperations = report.factOperations.slice(0, 120);
report.unresolvedConnectionCount = phaseGraph.edges.concat(sceneGraph.edges).filter(edge => !edge.resolved).length;
if (report.unresolvedConnectionCount) report.warnings.push(report.unresolvedConnectionCount + ' socket connection(s) could not be resolved to a node ID; inspect their handle IDs in the trace data before treating a route as complete.');

const exitResult = buildExitTraces(phaseNodes, phaseGraph, scenePath);
report.sceneExits = exitResult.exits.slice(0, 60);
report.exitToFactWriteTraces = exitResult.traces.slice(0, 60);
if (!exitResult.sceneNodeIds.length) report.warnings.push('No questSceneNodeDefinition referencing q003_03_deal.scene was found in q003_royce_deal.questphase.');
if (!report.sceneExits.length) report.warnings.push('No output sockets were found on the q003_03_deal scene node in q003_royce_deal.questphase.');

Logger.Info(REPORT_MARKER + JSON.stringify(report));
Logger.Info('Q003 report ready: ' + report.resources.length + ' resources, ' + report.nodeCount + ' nodes, ' + report.connectionCount + ' connections, ' + report.factOperations.length + ' fact nodes, ' + report.sceneExits.length + ' scene exits, ' + report.exitToFactWriteTraces.length + ' exit trace(s).');
